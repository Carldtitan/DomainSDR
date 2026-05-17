import { pollAgentMailReplies, replyWithAgentMail, sendEmailWithAgentMail } from "@/lib/agentMailService";
import { addConversationEvent, addOutboundMessage, isSuppressed, loadStore, updateLead } from "@/lib/campaignStore";
import { outboundEmailRecipient } from "@/lib/contactRouting";
import { generateFollowUpEmail } from "@/lib/llmService";
import { saveToSupermemory } from "@/lib/supermemoryService";
import type { OutboundMessage } from "@/lib/types";

type AgentTickOptions = {
  sendFollowUps?: boolean;
  minHoursSinceLastSend?: number;
  maxFollowUpsPerTick?: number;
  maxDailySends?: number;
};

function hoursBetween(value: string, now = new Date()) {
  return (now.getTime() - new Date(value).getTime()) / 3_600_000;
}

function defaultOptions(): Required<AgentTickOptions> {
  return {
    sendFollowUps: process.env.AGENT_AUTOPILOT_FOLLOWUPS !== "false",
    minHoursSinceLastSend: Number(process.env.AGENT_FOLLOWUP_MIN_HOURS || 72),
    maxFollowUpsPerTick: Number(process.env.AGENT_FOLLOWUP_MAX_SENDS_PER_TICK || 3),
    maxDailySends: Number(process.env.AGENT_FOLLOWUP_MAX_DAILY_SENDS || 5),
  };
}

function sentToday(messages: OutboundMessage[]) {
  const today = new Date().toISOString().slice(0, 10);
  return messages.filter((message) => message.status === "sent" && message.sent_at?.slice(0, 10) === today).length;
}

function portfolioRecommendations(store: Awaited<ReturnType<typeof loadStore>>) {
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

export async function runAgentTick(options: AgentTickOptions = {}) {
  const resolved = { ...defaultOptions(), ...options };
  const processedReplies = await pollAgentMailReplies();
  const store = await loadStore();
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

  return {
    processedReplies,
    followUps,
    sentFollowUps,
    skipped,
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
