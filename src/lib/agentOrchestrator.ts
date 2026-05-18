import { pollAgentMailReplies, replyWithAgentMail, sendEmailWithAgentMail } from "@/lib/agentMailService";
import { discoverBuyers } from "@/lib/apifyService";
import { enrichLeadContact } from "@/lib/contactEnrichment";
import {
  addConversationEvent,
  addOrUpdateOutboundMessage,
  addOutboundMessage,
  addSuppression,
  isSuppressed,
  loadStore,
  updateCampaign,
  updateConversationEvent,
  updateLead,
  updateOutboundMessage,
  upsertLeads,
} from "@/lib/campaignStore";
import { outboundEmailRecipient, outboundPhoneRecipient } from "@/lib/contactRouting";
import { analyzeDomain, generateFollowUpEmail, generateOutboundEmail } from "@/lib/llmService";
import { generateNegotiationReply } from "@/lib/negotiationEngine";
import { createDepositLink } from "@/lib/paymentService";
import { reconcileLeadFromReplyBody } from "@/lib/leadIdentity";
import { advancePostDepositHandoffs } from "@/lib/postDepositService";
import { saveToSupermemory, saveWorkspaceSnapshot } from "@/lib/supermemoryService";
import { sendOwnerSmsUpdate, startAgentPhoneCall } from "@/lib/agentPhoneService";
import type { AppStore, BuyerLead, ConversationEvent, DomainCampaign, NegotiationPolicy, OutboundMessage } from "@/lib/types";

type AgentTickOptions = {
  campaignId?: string;
  forceResearch?: boolean;
  discoverBuyers?: boolean;
  sendFirstTouch?: boolean;
  sendNegotiationReplies?: boolean;
  sendFollowUps?: boolean;
  makePhoneCalls?: boolean;
  minHoursSinceLastSend?: number;
  minHoursBetweenResearch?: number;
  minLeadsPerCampaign?: number;
  maxNegotiationRepliesPerTick?: number;
  maxDraftsPerTick?: number;
  maxFirstTouchSendsPerTick?: number;
  maxFollowUpsPerTick?: number;
  maxCallsPerTick?: number;
  maxContactEnrichmentPerTick?: number;
  maxDailyNegotiationSends?: number;
  maxDailySends?: number;
  minReachablePerCampaign?: number;
  maxLeadPoolPerCampaign?: number;
  maxResearchCampaignsPerTick?: number;
};

function isDraftableLead(lead: BuyerLead) {
  const text = `${lead.company_name} ${lead.website} ${lead.source_url}`.toLowerCase();
  if (lead.fit_score < 60) return false;
  if (!lead.contact_email) return false;
  if (/\b(top|best)\s+\d+\b|companies in|company profile|apps on google play|github|seedtable|tracxn|industry\b/.test(text)) {
    return false;
  }
  if (/(google\.com|github\.com|dev\.to|tracxn\.com|seedtable\.com|medium\.com|forbes\.com|techcrunch\.com)/.test(text)) {
    return false;
  }
  return true;
}

function hoursBetween(value: string, now = new Date()) {
  return (now.getTime() - new Date(value).getTime()) / 3_600_000;
}

function defaultOptions(): Required<AgentTickOptions> {
  return {
    campaignId: "",
    forceResearch: false,
    discoverBuyers: process.env.AGENT_AUTOPILOT_RESEARCH !== "false",
    sendFirstTouch: process.env.AGENT_AUTOPILOT_FIRST_TOUCH_EMAILS !== "false",
    sendNegotiationReplies: process.env.AGENT_AUTOPILOT_NEGOTIATION_REPLIES !== "false",
    sendFollowUps: process.env.AGENT_AUTOPILOT_FOLLOWUPS !== "false",
    makePhoneCalls: process.env.AGENT_AUTOPILOT_CALLS === "true",
    minHoursSinceLastSend: Number(process.env.AGENT_FOLLOWUP_MIN_HOURS || 72),
    minHoursBetweenResearch: Number(process.env.AGENT_RESEARCH_MIN_HOURS || 6),
    minLeadsPerCampaign: Number(process.env.AGENT_MIN_LEADS_PER_CAMPAIGN || 20),
    maxNegotiationRepliesPerTick: Number(process.env.AGENT_NEGOTIATION_MAX_SENDS_PER_TICK || 5),
    maxDraftsPerTick: Number(process.env.AGENT_MAX_DRAFTS_PER_TICK || 10),
    maxFirstTouchSendsPerTick: Number(process.env.AGENT_FIRST_TOUCH_MAX_SENDS_PER_TICK || 5),
    maxFollowUpsPerTick: Number(process.env.AGENT_FOLLOWUP_MAX_SENDS_PER_TICK || 5),
    maxCallsPerTick: Number(process.env.AGENT_CALL_MAX_PER_TICK || 2),
    maxContactEnrichmentPerTick: Number(process.env.AGENT_CONTACT_ENRICH_MAX_PER_TICK || 6),
    maxDailyNegotiationSends: Number(process.env.AGENT_NEGOTIATION_MAX_DAILY_SENDS || 20),
    maxDailySends: Number(process.env.AGENT_FOLLOWUP_MAX_DAILY_SENDS || 15),
    minReachablePerCampaign: Number(process.env.AGENT_MIN_REACHABLE_PER_CAMPAIGN || 5),
    maxLeadPoolPerCampaign: Number(process.env.AGENT_MAX_LEAD_POOL_PER_CAMPAIGN || 40),
    maxResearchCampaignsPerTick: Number(process.env.AGENT_RESEARCH_CAMPAIGNS_PER_TICK || 2),
  };
}

function activeCampaigns(store: AppStore, campaignId = "") {
  return store.campaigns.filter(
    (item) => !["closed", "paused"].includes(item.status) && (!campaignId || item.id === campaignId),
  );
}

async function researchCampaigns(store: AppStore, resolved: Required<AgentTickOptions>) {
  if (!resolved.discoverBuyers) return [];
  const researched = [];

  for (const campaign of activeCampaigns(store, resolved.campaignId)) {
    const campaignLeads = store.buyerLeads.filter((lead) => lead.campaign_id === campaign.id);
    const leadCount = campaignLeads.length;
    const reachableCount = campaignLeads.filter((lead) => lead.contact_email || lead.contact_phone).length;
    const recentlyResearched = hoursBetween(campaign.updated_at) < resolved.minHoursBetweenResearch;
    const noLeads = leadCount === 0;
    const needsMoreLeads = leadCount < resolved.minLeadsPerCampaign;
    const needsMoreReachableContacts =
      reachableCount < resolved.minReachablePerCampaign && leadCount < resolved.maxLeadPoolPerCampaign;
    const researchIsDue = noLeads || !recentlyResearched || resolved.forceResearch;
    const shouldResearch =
      researchIsDue &&
      (noLeads ||
        ((needsMoreLeads || needsMoreReachableContacts) &&
          !["deposit_requested", "negotiating"].includes(campaign.status)));

    if (!shouldResearch) continue;

    console.log("[agent] research started", {
      campaignId: campaign.id,
      domain: campaign.domain,
      leadCount,
      reachableCount,
    });
    await updateCampaign(campaign.id, { status: "researching" });
    const analysis = campaign.analysis || (await analyzeDomain(campaign.domain, campaign.use_case_thesis));
    if (!campaign.analysis) await updateCampaign(campaign.id, { analysis });
    const discovered = await discoverBuyers(campaign, analysis, {
      enrichContacts: false,
      scoreWithLlm: false,
      maxQueries: 4,
      maxCandidates: Math.min(
        resolved.maxLeadPoolPerCampaign,
        Math.max(15, resolved.minLeadsPerCampaign, leadCount + 10),
      ),
    });
    const leads = await upsertLeads(campaign.id, discovered);
    console.log("[agent] research saved", { campaignId: campaign.id, domain: campaign.domain, leads: leads.length });
    await saveToSupermemory({
      campaignId: campaign.id,
      type: "agent_buyer_research",
      content: JSON.stringify({ analysis, leads }, null, 2),
    });
    researched.push({ campaign_id: campaign.id, domain: campaign.domain, leads_found: leads.length });
    if (researched.length >= resolved.maxResearchCampaignsPerTick) break;
  }

  return researched;
}

function leadContactInput(lead: BuyerLead) {
  return {
    company_name: lead.company_name,
    website: lead.website,
    current_domain: lead.current_domain,
    buyer_category: lead.buyer_category,
    fit_score: lead.fit_score,
    reason_fit: lead.reason_fit,
    current_domain_weakness: lead.current_domain_weakness,
    contact_email: lead.contact_email,
    contact_url: lead.contact_url,
    contact_phone: lead.contact_phone,
    phone_source_url: lead.phone_source_url,
    decision_maker_name: lead.decision_maker_name,
    decision_maker_role: lead.decision_maker_role,
    source_url: lead.source_url,
    outreach_angle: lead.outreach_angle,
    next_action: lead.next_action,
    status: lead.status,
  };
}

async function enrichReachableContacts(store: AppStore, resolved: Required<AgentTickOptions>) {
  if (resolved.maxContactEnrichmentPerTick <= 0) return [];

  const leads = store.buyerLeads
    .filter((lead) => !resolved.campaignId || lead.campaign_id === resolved.campaignId)
    .filter((lead) => !lead.contact_email && !lead.contact_phone)
    .filter((lead) => !["opted_out", "escalated", "deposit_requested"].includes(lead.status))
    .sort((a, b) => {
      const aAlreadyTried = a.next_action?.includes("No public email or phone found yet.") ? 1 : 0;
      const bAlreadyTried = b.next_action?.includes("No public email or phone found yet.") ? 1 : 0;
      if (aAlreadyTried !== bAlreadyTried) return aAlreadyTried - bAlreadyTried;
      if (aAlreadyTried && bAlreadyTried) {
        return (Date.parse(a.updated_at) || 0) - (Date.parse(b.updated_at) || 0);
      }
      return b.fit_score - a.fit_score;
    })
    .slice(0, resolved.maxContactEnrichmentPerTick);

  const browserFallbackLimit = Number(process.env.BROWSER_USE_CONTACT_MAX_LEADS || 1);
  const results = await Promise.allSettled(leads.map(async (lead, index) => {
    try {
      console.log("[agent] contact enrichment started", { campaignId: lead.campaign_id, leadId: lead.id, company: lead.company_name });
      const enriched = await enrichLeadContact(leadContactInput(lead), { browserFallback: index < browserFallbackLimit });
      const contactEmail = enriched.contact_email || "";
      const contactPhone = enriched.contact_phone || "";
      await updateLead(lead.id, {
        contact_email: contactEmail,
        contact_url: enriched.contact_url || lead.contact_url,
        contact_phone: contactPhone,
        phone_source_url: enriched.phone_source_url,
        decision_maker_name: enriched.decision_maker_name,
        decision_maker_role: enriched.decision_maker_role,
        reason_fit: enriched.reason_fit,
        next_action: contactEmail
          ? "Public email found; outreach can be drafted."
          : contactPhone
            ? "Public phone found; phone outreach can be queued."
            : "No public email or phone found yet.",
      });
      const result = {
        campaign_id: lead.campaign_id,
        buyer_lead_id: lead.id,
        company_name: lead.company_name,
        contact_email: contactEmail,
        contact_phone: contactPhone,
      };
      console.log("[agent] contact enrichment completed", {
        campaignId: lead.campaign_id,
        leadId: lead.id,
        email: Boolean(contactEmail),
        phone: Boolean(contactPhone),
      });
      return result;
    } catch (error) {
      console.error("[agent] contact enrichment failed", {
        campaignId: lead.campaign_id,
        leadId: lead.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }));

  return results.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []));
}

async function prepareOutreachDrafts(store: AppStore, maxDrafts: number, campaignId = "") {
  const drafted = [];
  for (const campaign of activeCampaigns(store, campaignId)) {
    const existing = new Set(
      store.outboundMessages
        .filter((message) => message.campaign_id === campaign.id)
        .map((message) => message.buyer_lead_id),
    );
    const leads = store.buyerLeads
      .filter(
        (lead) =>
          lead.campaign_id === campaign.id &&
          !existing.has(lead.id) &&
          !["opted_out", "escalated"].includes(lead.status) &&
          isDraftableLead(lead),
      )
      .sort((a, b) => b.fit_score - a.fit_score)
      .slice(0, Math.max(0, maxDrafts - drafted.length));

    const results = await Promise.allSettled(leads.map(async (lead) => {
      const generated = await generateOutboundEmail(campaign, lead);
      const message = await addOrUpdateOutboundMessage({
        campaign_id: campaign.id,
        buyer_lead_id: lead.id,
        subject: generated.subject,
        body: generated.body,
        status: "draft",
        to_email: outboundEmailRecipient(lead.contact_email),
      });
      await updateLead(lead.id, {
        status: "email_drafted",
        next_action: "Outbound drafted; broker can send under campaign guardrails.",
      });
      return { campaign_id: campaign.id, buyer_lead_id: lead.id, company_name: lead.company_name, message_id: message.id };
    }));

    for (const result of results) {
      if (result.status === "fulfilled") drafted.push(result.value);
      if (drafted.length >= maxDrafts) return drafted;
    }
  }
  return drafted;
}

async function sendFirstTouchOutreach(store: AppStore, resolved: Required<AgentTickOptions>, sendsRemaining: number) {
  if (!resolved.sendFirstTouch || sendsRemaining <= 0) return { sentFirstTouch: [], skippedFirstTouch: [], sendsRemaining };

  const sentFirstTouch = [];
  const skippedFirstTouch = [];
  const drafts = store.outboundMessages
    .filter((message) => !resolved.campaignId || message.campaign_id === resolved.campaignId)
    .filter((message) => message.status === "draft")
    .map((message) => ({
      message,
      lead: store.buyerLeads.find((lead) => lead.id === message.buyer_lead_id),
      campaign: store.campaigns.find((campaign) => campaign.id === message.campaign_id),
    }))
    .filter((item): item is { message: OutboundMessage; lead: BuyerLead; campaign: DomainCampaign } =>
      Boolean(item.lead && item.campaign && isDraftableLead(item.lead)),
    )
    .sort((a, b) => b.lead.fit_score - a.lead.fit_score);

  for (const { message, lead, campaign } of drafts) {
    if (sentFirstTouch.length >= resolved.maxFirstTouchSendsPerTick || sendsRemaining <= 0) break;
    const recipient = outboundEmailRecipient(lead.contact_email);
    if (await isSuppressed(campaign.id, lead.id, recipient)) {
      skippedFirstTouch.push({ buyer_lead_id: lead.id, reason: "suppressed" });
      continue;
    }

    const sent = await sendEmailWithAgentMail(recipient, message.subject, message.body);
    await updateOutboundMessage(message.id, {
      to_email: recipient,
      status: sent.message_id ? "sent" : "failed",
      agentmail_message_id: sent.message_id,
      agentmail_thread_id: sent.thread_id,
      sent_at: new Date().toISOString(),
      error: sent.error,
    });
    await updateLead(lead.id, {
      status: sent.message_id ? "sent" : lead.status,
      next_action: sent.message_id ? "Await reply; one follow-up allowed later." : "Outbound send failed; review delivery settings.",
    });
    if (["draft", "analyzed", "ready_for_outreach"].includes(campaign.status)) {
      await updateCampaign(campaign.id, { status: "outreach_active" });
    }
    await addConversationEvent({
      campaign_id: campaign.id,
      buyer_lead_id: lead.id,
      channel: "email",
      direction: "outbound",
      body: message.body,
      classification: "sent_email",
      next_action: sent.message_id ? "Await reply" : "Send failed; review delivery settings.",
      agentmail_message_id: sent.message_id,
      agentmail_thread_id: sent.thread_id,
    });
    await saveToSupermemory({
      campaignId: campaign.id,
      type: "agent_first_touch_sent",
      content: JSON.stringify({ lead, message, recipient, sent }, null, 2),
    });
    sentFirstTouch.push({ campaign_id: campaign.id, buyer_lead_id: lead.id, company_name: lead.company_name, message_id: message.id, sent });
    if (sent.message_id) sendsRemaining -= 1;
  }

  return { sentFirstTouch, skippedFirstTouch, sendsRemaining };
}

async function placeDuePhoneCalls(store: AppStore, resolved: Required<AgentTickOptions>) {
  if (!resolved.makePhoneCalls) return { placedCalls: [], skippedCalls: [] };

  const placedCalls = [];
  const skippedCalls = [];

  for (const lead of store.buyerLeads) {
    if (placedCalls.length >= resolved.maxCallsPerTick) break;
    if (resolved.campaignId && lead.campaign_id !== resolved.campaignId) continue;
    if (!lead.contact_phone) continue;
    if (!["new", "scored", "sent", "email_drafted"].includes(lead.status)) continue;

    const campaign = store.campaigns.find((item) => item.id === lead.campaign_id);
    const policy = store.negotiationPolicies.find((item) => item.campaign_id === lead.campaign_id);
    if (!campaign || !policy) continue;

    const alreadyCalled = store.conversationEvents.some(
      (event) => event.buyer_lead_id === lead.id && event.channel === "phone" && event.direction === "outbound",
    );
    if (alreadyCalled) continue;

    const sentMessages = store.outboundMessages
      .filter((message) => message.buyer_lead_id === lead.id && message.status === "sent" && message.sent_at)
      .sort((a, b) => (b.sent_at || "").localeCompare(a.sent_at || ""));
    const lastSent = sentMessages[0];
    if (lastSent?.sent_at && hoursBetween(lastSent.sent_at) < 24) continue;

    const result = await startAgentPhoneCall({ campaign, lead, policy, toNumber: outboundPhoneRecipient() });
    if (result.ok) {
      placedCalls.push({
        campaign_id: campaign.id,
        buyer_lead_id: lead.id,
        company_name: lead.company_name,
        discoveredPhone: lead.contact_phone,
        controlledRecipient: outboundPhoneRecipient(),
        result,
      });
    } else {
      skippedCalls.push({ buyer_lead_id: lead.id, company_name: lead.company_name, discoveredPhone: lead.contact_phone, error: result.error });
      await updateLead(lead.id, { next_action: `Phone call not placed: ${result.error}` });
    }
  }

  return { placedCalls, skippedCalls };
}

function sentToday(messages: OutboundMessage[], campaignId = "") {
  const today = new Date().toISOString().slice(0, 10);
  return messages.filter(
    (message) =>
      message.status === "sent" &&
      message.sent_at?.slice(0, 10) === today &&
      (!campaignId || message.campaign_id === campaignId),
  ).length;
}

function negotiationRepliesSentToday(messages: OutboundMessage[], campaignId = "") {
  const today = new Date().toISOString().slice(0, 10);
  return messages.filter(
    (message) =>
      message.status === "sent" &&
      message.sent_at?.slice(0, 10) === today &&
      message.subject.toLowerCase().startsWith("re:") &&
      (!campaignId || message.campaign_id === campaignId),
  ).length;
}

function portfolioRecommendations(store: AppStore, campaignId = "") {
  return store.campaigns.filter((campaign) => !campaignId || campaign.id === campaignId).map((campaign) => {
    const leads = store.buyerLeads.filter((lead) => lead.campaign_id === campaign.id);
    const messages = store.outboundMessages.filter((message) => message.campaign_id === campaign.id);
    const inbound = store.conversationEvents.filter((event) => event.campaign_id === campaign.id && event.direction === "inbound");
    const offers = store.offers.filter((offer) => offer.campaign_id === campaign.id);
    const sent = messages.filter((message) => message.status === "sent").length;
    const replyRate = sent > 0 ? inbound.length / sent : 0;
    const bestOffer = offers.reduce((max, offer) => Math.max(max, offer.amount), 0);

    let recommendation = "Outbound";
    let reason = "Campaign is active and has buyer leads to work.";

    if (leads.length === 0) {
      recommendation = "Outbound";
      reason = "No buyer leads found yet. Run discovery with expanded buyer categories before changing price.";
    } else if (sent === 0) {
      recommendation = "Outbound";
      reason = "Leads exist, but no outreach has been sent.";
    } else if (replyRate === 0 && sent >= 5) {
      recommendation = "Price down or re-angle";
      reason = "Five or more emails sent with no replies. Improve category fit or reduce ask before more outbound.";
    } else if (bestOffer > 0 && bestOffer < campaign.floor_price) {
      recommendation = "Hold floor";
      reason = "Offer received below seller floor. Keep negotiating above floor or pause.";
    } else if (bestOffer >= campaign.floor_price) {
      recommendation = "Escalate";
      reason = "Offer is at or above floor. Human approval or deposit path should be prioritized.";
    }

    return {
      campaign_id: campaign.id,
      domain: campaign.domain,
      recommendation,
      reason,
      metrics: {
        leads: leads.length,
        sent,
        replies: inbound.length,
        replyRate,
        bestOffer,
      },
    };
  });
}

type OwnerTickSummary = {
  sentFirstTouch: { campaign_id: string; company_name: string; sent: { message_id?: string } }[];
  sentFollowUps: { campaign_id: string; company_name: string; sent: { message_id?: string } }[];
  agentResponses: { campaign_id: string; company_name: string; sent: { message_id?: string }; depositOffer?: unknown }[];
  placedCalls: { campaign_id: string; company_name: string; result: { ok?: boolean } }[];
};

async function sendOwnerTickUpdates(store: AppStore, summary: OwnerTickSummary) {
  const linesByCampaign = new Map<string, string[]>();
  const add = (campaignId: string, line: string) => {
    linesByCampaign.set(campaignId, [...(linesByCampaign.get(campaignId) || []), line]);
  };

  const firstTouchByCampaign = new Map<string, number>();
  for (const item of summary.sentFirstTouch.filter((item) => item.sent?.message_id)) {
    firstTouchByCampaign.set(item.campaign_id, (firstTouchByCampaign.get(item.campaign_id) || 0) + 1);
  }
  for (const [campaignId, count] of firstTouchByCampaign) {
    add(campaignId, `${count} first email${count === 1 ? "" : "s"} sent.`);
  }

  for (const item of summary.sentFollowUps.filter((item) => item.sent?.message_id)) {
    add(item.campaign_id, `Follow-up sent to ${item.company_name}.`);
  }

  for (const item of summary.agentResponses.filter((item) => item.sent?.message_id)) {
    add(item.campaign_id, item.depositOffer ? `Deposit link sent to ${item.company_name}.` : `Reply handled from ${item.company_name}.`);
  }

  for (const item of summary.placedCalls.filter((item) => item.result?.ok)) {
    add(item.campaign_id, `Call started to ${item.company_name}.`);
  }

  for (const [campaignId, lines] of linesByCampaign) {
    const campaign = store.campaigns.find((item) => item.id === campaignId);
    if (!campaign) continue;
    await sendOwnerSmsUpdate({
      campaign,
      body: `${campaign.domain}: ${lines.join(" ")}`,
      type: "owner_sms_agent_update",
    });
  }
}

function hasOutboundAfter(store: AppStore, event: ConversationEvent, lead: BuyerLead) {
  return store.conversationEvents.some(
    (candidate) =>
      candidate.buyer_lead_id === lead.id &&
      candidate.direction === "outbound" &&
      candidate.created_at > event.created_at,
  );
}

function pendingNegotiationEvents(store: AppStore, campaignId = "") {
  return store.conversationEvents
    .filter((event) => event.direction === "inbound" && (!campaignId || event.campaign_id === campaignId))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .filter((event) => {
      const currentLead = store.buyerLeads.find((lead) => lead.id === event.buyer_lead_id);
      if (!currentLead) return false;
      const lead = reconcileLeadFromReplyBody(event.body, currentLead, store.buyerLeads);
      return !hasOutboundAfter(store, event, lead);
    });
}

function isPositiveReengagement(event: ConversationEvent) {
  if (["opt_out", "not_interested"].includes(event.classification)) return false;
  return /\b(yes|interested|proceed|move forward|go ahead|send (the )?(link|invoice)|checkout|deposit|buy|purchase|offer|works for me|sounds good)\b|\$\s*\d/i.test(
    event.body,
  );
}

function blockingNegotiationSuppression(store: AppStore, campaign: DomainCampaign, lead: BuyerLead, event: ConversationEvent) {
  const leadEmail = lead.contact_email.toLowerCase();
  const suppression = store.suppressions
    .filter(
      (item) =>
        item.campaign_id === campaign.id &&
        (item.buyer_lead_id === lead.id || (leadEmail && item.email?.toLowerCase() === leadEmail)),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  if (!suppression) return undefined;
  if (event.created_at > suppression.created_at && isPositiveReengagement(event)) return undefined;
  return suppression;
}

function depositReplyBody(campaign: DomainCampaign, draftBody: string, paymentLink: string) {
  return `${draftBody}

Deposit link: ${paymentLink}

This deposit confirms intent only. The actual ${campaign.domain} transfer should still run through escrow or a trusted marketplace.`;
}

async function sendNegotiationResponse({
  campaign,
  lead,
  policy,
  event,
}: {
  campaign: DomainCampaign;
  lead: BuyerLead;
  policy: NegotiationPolicy;
  event: ConversationEvent;
}) {
  const draft = generateNegotiationReply(campaign, lead, event, policy);
  let responseBody = draft.body;
  let depositOffer;
  const amount = draft.accepted_amount || event.offer_amount;

  if (draft.should_request_deposit) {
    depositOffer = await createDepositLink(campaign, lead, amount || policy.ask_price);
    responseBody = depositReplyBody(campaign, draft.body, depositOffer.payment_link);
  }

  const sent = await replyWithAgentMail(event.agentmail_message_id, responseBody);
  const subject = `Re: ${campaign.domain}`;
  const message = await addOutboundMessage({
    campaign_id: campaign.id,
    buyer_lead_id: lead.id,
    subject,
    body: responseBody,
    status: sent.message_id ? "sent" : "failed",
    to_email: outboundEmailRecipient(lead.contact_email),
    agentmail_message_id: sent.message_id,
    agentmail_thread_id: sent.thread_id || event.agentmail_thread_id,
    sent_at: new Date().toISOString(),
    error: sent.error,
  });
  const outboundEvent = await addConversationEvent({
    campaign_id: campaign.id,
    buyer_lead_id: lead.id,
    channel: "email",
    direction: "outbound",
    body: responseBody,
    classification: "sent_email",
    offer_amount: amount,
    next_action: draft.should_request_deposit ? "Deposit requested; await deposit." : "Await buyer response.",
    agentmail_message_id: sent.message_id,
    agentmail_thread_id: sent.thread_id || event.agentmail_thread_id,
  });

  if (draft.should_suppress) {
    await addSuppression({
      campaign_id: campaign.id,
      buyer_lead_id: lead.id,
      email: lead.contact_email || outboundEmailRecipient(lead.contact_email),
      reason: event.classification,
    });
    await updateLead(lead.id, { status: "opted_out", next_action: "Suppressed" });
  } else {
    await updateLead(lead.id, {
      status: draft.should_request_deposit ? "deposit_requested" : "negotiating",
      next_action: draft.should_request_deposit ? "Await deposit" : draft.next_action,
    });
  }

  await saveToSupermemory({
    campaignId: campaign.id,
    type: draft.should_request_deposit ? "agent_deposit_requested" : "agent_negotiation_response",
    content: JSON.stringify({ lead, inbound: event, outbound: outboundEvent, message, sent, depositOffer }, null, 2),
  });

  return {
    campaign_id: campaign.id,
    buyer_lead_id: lead.id,
    company_name: lead.company_name,
    inbound_event_id: event.id,
    outbound_event_id: outboundEvent.id,
    outbound_message_id: message.id,
    sent,
    depositOffer,
  };
}

async function advanceNegotiations(store: AppStore, resolved: Required<AgentTickOptions>, sendsRemaining: number) {
  const agentResponses = [];
  const skippedNegotiations = [];

  for (const event of pendingNegotiationEvents(store, resolved.campaignId)) {
    if (agentResponses.length >= resolved.maxNegotiationRepliesPerTick) {
      skippedNegotiations.push({ event_id: event.id, reason: "negotiation send cap reached" });
      continue;
    }

    const currentLead = store.buyerLeads.find((lead) => lead.id === event.buyer_lead_id);
    if (!currentLead) continue;
    const lead = reconcileLeadFromReplyBody(event.body, currentLead, store.buyerLeads);
    if (lead.id !== event.buyer_lead_id) {
      await updateConversationEvent(event.id, { buyer_lead_id: lead.id });
      event.buyer_lead_id = lead.id;
      await updateLead(currentLead.id, {
        status: "escalated",
        next_action: "Reply self-identified as another buyer; follow-up paused for manual review.",
      });
    }

    const campaign = store.campaigns.find((item) => item.id === lead.campaign_id);
    const policy = store.negotiationPolicies.find((item) => item.campaign_id === lead.campaign_id);
    if (!campaign || !policy) continue;

    if (!resolved.sendNegotiationReplies) {
      await updateLead(lead.id, { next_action: "Agent response is ready; autopilot send is disabled." });
      skippedNegotiations.push({ event_id: event.id, buyer_lead_id: lead.id, reason: "autopilot disabled" });
      continue;
    }

    if (sendsRemaining <= 0) {
      await updateLead(lead.id, { next_action: "Agent response is ready, but daily send cap was reached." });
      skippedNegotiations.push({ event_id: event.id, buyer_lead_id: lead.id, reason: "daily send cap reached" });
      continue;
    }

    const suppression = blockingNegotiationSuppression(store, campaign, lead, event);
    if (suppression) {
      skippedNegotiations.push({ event_id: event.id, buyer_lead_id: lead.id, reason: `suppressed: ${suppression.reason}` });
      continue;
    }

    const draft = generateNegotiationReply(campaign, lead, event, policy);
    const humanApprovalOnly = draft.should_escalate && !draft.should_request_deposit && event.classification !== "legal_concern";
    if (humanApprovalOnly) {
      await updateLead(lead.id, {
        status: "escalated",
        next_action: `${draft.next_action} Owner approval recommended before responding.`,
      });
      await addConversationEvent({
        campaign_id: campaign.id,
        buyer_lead_id: lead.id,
        channel: "manual",
        direction: "outbound",
        body: `Agent paused: serious offer or sensitive negotiation requires owner approval before sending. Suggested response:\n\n${draft.body}`,
        classification: "system_note",
        offer_amount: event.offer_amount,
        next_action: "Owner approval recommended.",
      });
      skippedNegotiations.push({ event_id: event.id, buyer_lead_id: lead.id, reason: "owner approval recommended" });
      continue;
    }

    const response = await sendNegotiationResponse({ campaign, lead, policy, event });
    agentResponses.push(response);
    if (response.sent.message_id) sendsRemaining -= 1;
  }

  return { agentResponses, skippedNegotiations, sendsRemaining };
}

export async function runAgentTick(options: AgentTickOptions = {}) {
  const resolved = { ...defaultOptions(), ...options };
  console.log("[agent] tick started", { campaignId: resolved.campaignId || "all" });
  const processedReplies = await pollAgentMailReplies();
  let store = await loadStore();
  const postDepositHandoffs = await advancePostDepositHandoffs(store, resolved.campaignId);
  store = await loadStore();
  const negotiationSendsRemaining = Math.max(
    0,
    resolved.maxDailyNegotiationSends - negotiationRepliesSentToday(store.outboundMessages, resolved.campaignId),
  );
  const negotiationResult = await advanceNegotiations(store, resolved, negotiationSendsRemaining);
  store = await loadStore();
  const researchedCampaigns = await researchCampaigns(store, resolved);
  store = await loadStore();
  const enrichedContacts = await enrichReachableContacts(store, resolved);
  store = await loadStore();
  const draftedOutreach = await prepareOutreachDrafts(store, resolved.maxDraftsPerTick, resolved.campaignId);
  store = await loadStore();
  let sendsRemaining = Math.max(0, resolved.maxDailySends - sentToday(store.outboundMessages, resolved.campaignId));
  const firstTouchResult = await sendFirstTouchOutreach(store, resolved, sendsRemaining);
  sendsRemaining = firstTouchResult.sendsRemaining;
  store = await loadStore();
  const followUps = [];
  const sentFollowUps = [];
  const skipped = [];
  const recommendations = portfolioRecommendations(store, resolved.campaignId);

  for (const lead of store.buyerLeads) {
    if (resolved.campaignId && lead.campaign_id !== resolved.campaignId) continue;
    if (["opted_out", "deposit_requested", "escalated"].includes(lead.status)) continue;
    const messages = store.outboundMessages.filter((message) => message.buyer_lead_id === lead.id && message.status === "sent");
    if (messages.length === 0) continue;
    const events = store.conversationEvents.filter((event) => event.buyer_lead_id === lead.id);
    const hasInbound = events.some((event) => event.direction === "inbound");
    if (hasInbound) continue;

    const lastSent = messages
      .filter((message) => message.sent_at)
      .sort((a, b) => (b.sent_at || "").localeCompare(a.sent_at || ""))[0];
    if (!lastSent?.sent_at) continue;
    if (messages.length >= 2) {
      skipped.push({ buyer_lead_id: lead.id, company_name: lead.company_name, reason: "one follow-up already sent" });
      continue;
    }
    if (hoursBetween(lastSent.sent_at) < resolved.minHoursSinceLastSend) continue;

    followUps.push({
      campaign_id: lead.campaign_id,
      buyer_lead_id: lead.id,
      company_name: lead.company_name,
      last_sent_at: lastSent.sent_at,
      recommendation: resolved.sendFollowUps
        ? "Agent should send one polite follow-up."
        : "Draft a single concise follow-up; do not send automatically.",
    });

    if (!resolved.sendFollowUps) {
      await updateLead(lead.id, {
        next_action: "Human review recommended: one polite follow-up is available, but not auto-sent.",
      });
      continue;
    }
    if (sentFollowUps.length >= resolved.maxFollowUpsPerTick || sendsRemaining <= 0) {
      await updateLead(lead.id, { next_action: "Follow-up is due, but send cap was reached." });
      continue;
    }
    if (await isSuppressed(lead.campaign_id, lead.id, lastSent.to_email || outboundEmailRecipient(lead.contact_email))) {
      skipped.push({ buyer_lead_id: lead.id, company_name: lead.company_name, reason: "suppressed" });
      continue;
    }

    const campaign = store.campaigns.find((item) => item.id === lead.campaign_id);
    if (!campaign) continue;
    const generated = await generateFollowUpEmail(campaign, lead, lastSent);
    const recipient = outboundEmailRecipient(lead.contact_email);
    const sent = lastSent.agentmail_message_id
      ? await replyWithAgentMail(lastSent.agentmail_message_id, generated.body)
      : await sendEmailWithAgentMail(recipient, generated.subject, generated.body);

    const message = await addOutboundMessage({
      campaign_id: campaign.id,
      buyer_lead_id: lead.id,
      subject: generated.subject,
      body: generated.body,
      status: sent.message_id ? "sent" : "failed",
      to_email: recipient,
      agentmail_message_id: sent.message_id,
      agentmail_thread_id: sent.thread_id || lastSent.agentmail_thread_id,
      sent_at: new Date().toISOString(),
      error: sent.error,
    });
    await addConversationEvent({
      campaign_id: campaign.id,
      buyer_lead_id: lead.id,
      channel: "email",
      direction: "outbound",
      body: generated.body,
      classification: "sent_email",
      next_action: sent.message_id ? "One follow-up sent; await reply." : "Follow-up send failed; review AgentMail.",
      agentmail_message_id: sent.message_id,
      agentmail_thread_id: sent.thread_id || lastSent.agentmail_thread_id,
    });
    await updateLead(lead.id, {
      status: sent.message_id ? "sent" : lead.status,
      next_action: sent.message_id ? "One follow-up sent; await reply." : "Follow-up send failed; review AgentMail.",
    });
    await saveToSupermemory({
      campaignId: campaign.id,
      type: "agent_follow_up",
      content: JSON.stringify({ lead, message, sent }, null, 2),
    });

    sentFollowUps.push({ campaign_id: campaign.id, buyer_lead_id: lead.id, company_name: lead.company_name, message_id: message.id, sent });
    sendsRemaining -= sent.message_id ? 1 : 0;
  }

  store = await loadStore();
  const phoneResult = await placeDuePhoneCalls(store, resolved);
  store = await loadStore();
  await sendOwnerTickUpdates(store, {
    sentFirstTouch: firstTouchResult.sentFirstTouch,
    sentFollowUps,
    agentResponses: negotiationResult.agentResponses,
    placedCalls: phoneResult.placedCalls,
  });

  for (const recommendation of recommendations) {
    await saveToSupermemory({
      campaignId: recommendation.campaign_id,
      type: "portfolio_recommendation",
      content: JSON.stringify(recommendation, null, 2),
    });
  }

  await saveWorkspaceSnapshot(
    JSON.stringify(
      {
        updated_at: new Date().toISOString(),
        campaigns: store.campaigns.map((campaign) => ({
          id: campaign.id,
          domain: campaign.domain,
          status: campaign.status,
          ask_price: campaign.ask_price,
          leads: store.buyerLeads.filter((lead) => lead.campaign_id === campaign.id).length,
          sent: store.outboundMessages.filter((message) => message.campaign_id === campaign.id && message.status === "sent").length,
          replies: store.conversationEvents.filter((event) => event.campaign_id === campaign.id && event.direction === "inbound").length,
          offers: store.offers.filter((offer) => offer.campaign_id === campaign.id).length,
        })),
        recommendations,
      },
      null,
      2,
    ),
  );

  return {
    processedReplies,
    postDepositHandoffs,
    researchedCampaigns,
    enrichedContacts,
    followUps,
    sentFollowUps,
    sentFirstTouch: firstTouchResult.sentFirstTouch,
    skippedFirstTouch: firstTouchResult.skippedFirstTouch,
    placedCalls: phoneResult.placedCalls,
    skippedCalls: phoneResult.skippedCalls,
    skipped,
    draftedOutreach,
    agentResponses: negotiationResult.agentResponses,
    skippedNegotiations: negotiationResult.skippedNegotiations,
    recommendations,
    options: resolved,
    portfolio: {
      campaigns: store.campaigns.length,
      activeCampaigns: store.campaigns.filter((campaign) => !["closed", "paused"].includes(campaign.status)).length,
      leads: store.buyerLeads.length,
      sentMessages: store.outboundMessages.filter((message) => message.status === "sent").length,
      openOffers: store.offers.filter((offer) => !["rejected", "deposit_paid"].includes(offer.status)).length,
    },
  };
}
