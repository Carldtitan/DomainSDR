import { pollAgentMailReplies, replyWithAgentMail, sendEmailWithAgentMail } from "@/lib/agentMailService";
import {
  addConversationEvent,
  addOrUpdateOutboundMessage,
  addOutboundMessage,
  addSuppression,
  isSuppressed,
  loadStore,
  updateConversationEvent,
  updateLead,
} from "@/lib/campaignStore";
import { outboundEmailRecipient } from "@/lib/contactRouting";
import { generateFollowUpEmail, generateOutboundEmail } from "@/lib/llmService";
import { generateNegotiationReply } from "@/lib/negotiationEngine";
import { createDepositLink } from "@/lib/paymentService";
import { reconcileLeadFromReplyBody } from "@/lib/leadIdentity";
import { saveToSupermemory, saveWorkspaceSnapshot } from "@/lib/supermemoryService";
import type { AppStore, BuyerLead, ConversationEvent, DomainCampaign, NegotiationPolicy, OutboundMessage } from "@/lib/types";

type AgentTickOptions = {
  sendNegotiationReplies?: boolean;
  sendFollowUps?: boolean;
  minHoursSinceLastSend?: number;
  maxNegotiationRepliesPerTick?: number;
  maxDraftsPerTick?: number;
  maxFollowUpsPerTick?: number;
  maxDailyNegotiationSends?: number;
  maxDailySends?: number;
};

function isDraftableLead(lead: BuyerLead) {
  const text = `${lead.company_name} ${lead.website} ${lead.source_url}`.toLowerCase();
  if (lead.fit_score < 60) return false;
  if (!lead.contact_email && !lead.contact_url) return false;
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
    sendNegotiationReplies: process.env.AGENT_AUTOPILOT_NEGOTIATION_REPLIES !== "false",
    sendFollowUps: process.env.AGENT_AUTOPILOT_FOLLOWUPS !== "false",
    minHoursSinceLastSend: Number(process.env.AGENT_FOLLOWUP_MIN_HOURS || 72),
    maxNegotiationRepliesPerTick: Number(process.env.AGENT_NEGOTIATION_MAX_SENDS_PER_TICK || 5),
    maxDraftsPerTick: Number(process.env.AGENT_MAX_DRAFTS_PER_TICK || 5),
    maxFollowUpsPerTick: Number(process.env.AGENT_FOLLOWUP_MAX_SENDS_PER_TICK || 3),
    maxDailyNegotiationSends: Number(process.env.AGENT_NEGOTIATION_MAX_DAILY_SENDS || 20),
    maxDailySends: Number(process.env.AGENT_FOLLOWUP_MAX_DAILY_SENDS || 5),
  };
}

async function prepareOutreachDrafts(store: AppStore, maxDrafts: number) {
  const drafted = [];
  for (const campaign of store.campaigns.filter((item) => !["closed", "paused"].includes(item.status))) {
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

    for (const lead of leads) {
      const generated = await generateOutboundEmail(campaign, lead);
      const message = await addOrUpdateOutboundMessage({
        campaign_id: campaign.id,
        buyer_lead_id: lead.id,
        subject: generated.subject,
        body: generated.body,
        status: "draft",
        to_email: outboundEmailRecipient(),
      });
      await updateLead(lead.id, {
        status: "email_drafted",
        next_action: "Agent drafted outbound; awaiting send approval.",
      });
      drafted.push({ campaign_id: campaign.id, buyer_lead_id: lead.id, company_name: lead.company_name, message_id: message.id });
      if (drafted.length >= maxDrafts) return drafted;
    }
  }
  return drafted;
}

function sentToday(messages: OutboundMessage[]) {
  const today = new Date().toISOString().slice(0, 10);
  return messages.filter((message) => message.status === "sent" && message.sent_at?.slice(0, 10) === today).length;
}

function negotiationRepliesSentToday(messages: OutboundMessage[]) {
  const today = new Date().toISOString().slice(0, 10);
  return messages.filter(
    (message) =>
      message.status === "sent" &&
      message.sent_at?.slice(0, 10) === today &&
      message.subject.toLowerCase().startsWith("re:"),
  ).length;
}

function portfolioRecommendations(store: AppStore) {
  return store.campaigns.map((campaign) => {
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

function hasOutboundAfter(store: AppStore, event: ConversationEvent, lead: BuyerLead) {
  return store.conversationEvents.some(
    (candidate) =>
      candidate.buyer_lead_id === lead.id &&
      candidate.direction === "outbound" &&
      candidate.created_at > event.created_at,
  );
}

function pendingNegotiationEvents(store: AppStore) {
  return store.conversationEvents
    .filter((event) => event.direction === "inbound")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .filter((event) => {
      const currentLead = store.buyerLeads.find((lead) => lead.id === event.buyer_lead_id);
      if (!currentLead) return false;
      const lead = reconcileLeadFromReplyBody(event.body, currentLead, store.buyerLeads);
      return !hasOutboundAfter(store, event, lead);
    });
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
    to_email: outboundEmailRecipient(),
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
      email: lead.contact_email || outboundEmailRecipient(),
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

  for (const event of pendingNegotiationEvents(store)) {
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

    if (await isSuppressed(campaign.id, lead.id, lead.contact_email || outboundEmailRecipient())) {
      skippedNegotiations.push({ event_id: event.id, buyer_lead_id: lead.id, reason: "suppressed" });
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
  const processedReplies = await pollAgentMailReplies();
  let store = await loadStore();
  const draftedOutreach = await prepareOutreachDrafts(store, resolved.maxDraftsPerTick);
  store = await loadStore();
  const negotiationSendsRemaining = Math.max(
    0,
    resolved.maxDailyNegotiationSends - negotiationRepliesSentToday(store.outboundMessages),
  );
  const negotiationResult = await advanceNegotiations(store, resolved, negotiationSendsRemaining);
  store = await loadStore();
  const followUps = [];
  const sentFollowUps = [];
  const skipped = [];
  const recommendations = portfolioRecommendations(store);
  let sendsRemaining = Math.max(0, resolved.maxDailySends - sentToday(store.outboundMessages));

  for (const lead of store.buyerLeads) {
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
    if (await isSuppressed(lead.campaign_id, lead.id, lastSent.to_email || outboundEmailRecipient())) {
      skipped.push({ buyer_lead_id: lead.id, company_name: lead.company_name, reason: "suppressed" });
      continue;
    }

    const campaign = store.campaigns.find((item) => item.id === lead.campaign_id);
    if (!campaign) continue;
    const generated = await generateFollowUpEmail(campaign, lead, lastSent);
    const recipient = outboundEmailRecipient();
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

    sentFollowUps.push({ buyer_lead_id: lead.id, company_name: lead.company_name, message_id: message.id, sent });
    sendsRemaining -= sent.message_id ? 1 : 0;
  }

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
    followUps,
    sentFollowUps,
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
