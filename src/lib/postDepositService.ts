import { addConversationEvent, addOutboundMessage, updateLead } from "@/lib/campaignStore";
import { replyWithAgentMail, sendEmailWithAgentMail } from "@/lib/agentMailService";
import { startAgentPhoneSchedulingCall } from "@/lib/agentPhoneService";
import { outboundEmailRecipient, outboundPhoneRecipient } from "@/lib/contactRouting";
import { money } from "@/lib/format";
import { saveToSupermemory } from "@/lib/supermemoryService";
import type { AppStore, BuyerLead, ConversationEvent, DomainCampaign, NegotiationPolicy, Offer, OutboundMessage } from "@/lib/types";

const HANDOFF_NEXT_ACTION = "Await buyer phone and weekend availability.";
const SCHEDULING_NEXT_ACTION = "Weekend handoff scheduling call started.";

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1 ${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15 && value.trim().startsWith("+")) return `+${digits}`;
  return "";
}

export function extractPhoneNumber(text: string) {
  const phoneRegex = /(?:\+?1[\s.-]?)?(?:\(?[2-9]\d{2}\)?[\s.-]?)?[2-9]\d{2}[\s.-]?\d{4}/g;
  for (const match of text.match(phoneRegex) || []) {
    const normalized = normalizePhone(match);
    if (normalized) return normalized;
  }
  return "";
}

function latestSentMessage(messages: OutboundMessage[]) {
  return [...messages]
    .filter((message) => message.status === "sent")
    .sort((a, b) => (b.sent_at || b.created_at).localeCompare(a.sent_at || a.created_at))[0];
}

function latestPhoneFromEvents(events: ConversationEvent[]) {
  return [...events]
    .filter((event) => event.direction === "inbound")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((event) => extractPhoneNumber(event.body))
    .find(Boolean) || "";
}

function handoffEmailBody(campaign: DomainCampaign, offer: Offer) {
  return `Deposit received for ${campaign.domain}. The accepted sale amount is ${money(offer.amount)}. Next step is a short handoff call so we can confirm the transfer path.

What phone number should I use, and what time this weekend works for you? Carl is free any time Saturday or Sunday. Please include your timezone.

The actual domain transfer should still run through escrow or a trusted marketplace.

${campaign.owner_name}`;
}

function handoffAlreadyRequested(events: ConversationEvent[]) {
  return events.some(
    (event) =>
      event.channel === "email" &&
      event.direction === "outbound" &&
      event.classification === "sent_email" &&
      event.next_action === HANDOFF_NEXT_ACTION,
  );
}

function schedulingCallAlreadyStarted(events: ConversationEvent[]) {
  return events.some(
    (event) =>
      event.channel === "phone" &&
      event.direction === "outbound" &&
      event.next_action === SCHEDULING_NEXT_ACTION,
  );
}

async function sendHandoffRequest({
  campaign,
  lead,
  offer,
  messages,
}: {
  campaign: DomainCampaign;
  lead: BuyerLead;
  offer: Offer;
  messages: OutboundMessage[];
}) {
  const body = handoffEmailBody(campaign, offer);
  const latest = latestSentMessage(messages);
  const sent = latest?.agentmail_message_id
    ? await replyWithAgentMail(latest.agentmail_message_id, body)
    : await sendEmailWithAgentMail(outboundEmailRecipient(lead.contact_email), `Re: ${campaign.domain}`, body);
  const subject = latest?.subject?.toLowerCase().startsWith("re:") ? latest.subject : `Re: ${campaign.domain}`;

  const message = await addOutboundMessage({
    campaign_id: campaign.id,
    buyer_lead_id: lead.id,
    subject,
    body,
    status: sent.message_id ? "sent" : "failed",
    to_email: outboundEmailRecipient(lead.contact_email),
    agentmail_message_id: sent.message_id,
    agentmail_thread_id: sent.thread_id || latest?.agentmail_thread_id,
    sent_at: new Date().toISOString(),
    error: sent.error,
  });
  const event = await addConversationEvent({
    campaign_id: campaign.id,
    buyer_lead_id: lead.id,
    channel: "email",
    direction: "outbound",
    body,
    classification: "sent_email",
    offer_amount: offer.amount,
    next_action: HANDOFF_NEXT_ACTION,
    agentmail_message_id: sent.message_id,
    agentmail_thread_id: sent.thread_id || latest?.agentmail_thread_id,
  });
  await updateLead(lead.id, {
    status: "deposit_requested",
    next_action: sent.message_id ? HANDOFF_NEXT_ACTION : "Deposit paid; handoff email failed.",
  });
  await saveToSupermemory({
    campaignId: campaign.id,
    type: "post_deposit_handoff_request",
    content: JSON.stringify({ lead, offer, message, event, sent }, null, 2),
  });

  return { message, event, sent };
}

async function startSchedulingCall({
  campaign,
  lead,
  policy,
  offer,
  buyerPhone,
}: {
  campaign: DomainCampaign;
  lead: BuyerLead;
  policy: NegotiationPolicy;
  offer: Offer;
  buyerPhone: string;
}) {
  if (buyerPhone && buyerPhone !== lead.contact_phone) {
    await updateLead(lead.id, { contact_phone: buyerPhone, phone_source_url: "buyer_reply" });
  }

  const toNumber = process.env.ALLOW_EXTERNAL_PHONE_OUTBOUND === "true" && buyerPhone ? buyerPhone : outboundPhoneRecipient();
  const result = await startAgentPhoneSchedulingCall({ campaign, lead: { ...lead, contact_phone: buyerPhone || lead.contact_phone }, policy, offer, toNumber });
  if (!result.ok) {
    const resultData = "data" in result ? result.data : undefined;
    const detail = resultData ? ` ${JSON.stringify(resultData).slice(0, 240)}` : "";
    await addConversationEvent({
      campaign_id: campaign.id,
      buyer_lead_id: lead.id,
      channel: "manual",
      direction: "outbound",
      body: `AgentPhone scheduling call could not start: ${result.error || "unknown error"}.${detail}`,
      classification: "system_note",
      offer_amount: offer.amount,
      next_action: "Fix AgentPhone caller number, then retry scheduling call.",
    });
    await updateLead(lead.id, { next_action: `Deposit paid; AgentPhone scheduling not started: ${result.error}` });
  }
  return result;
}

export async function ensurePostDepositHandoff({
  campaign,
  lead,
  policy,
  offer,
  messages,
  events,
}: {
  campaign: DomainCampaign;
  lead: BuyerLead;
  policy: NegotiationPolicy;
  offer: Offer;
  messages: OutboundMessage[];
  events: ConversationEvent[];
}) {
  const actions: Record<string, unknown> = {};

  if (!handoffAlreadyRequested(events)) {
    actions.handoffRequest = await sendHandoffRequest({ campaign, lead, offer, messages });
  }

  const buyerPhone = lead.contact_phone || latestPhoneFromEvents(events);
  if (buyerPhone && !schedulingCallAlreadyStarted(events)) {
    actions.schedulingCall = await startSchedulingCall({ campaign, lead, policy, offer, buyerPhone });
  }

  if (!buyerPhone) {
    await updateLead(lead.id, {
      status: "deposit_requested",
      next_action: `Deposit paid. Waiting for buyer phone number. Seller is free this weekend. Sale amount ${money(offer.amount)}.`,
    });
  }

  return actions;
}

export async function advancePostDepositHandoffs(store: AppStore, campaignId = "") {
  const results = [];
  for (const offer of store.offers.filter((item) => item.status === "deposit_paid" && (!campaignId || item.campaign_id === campaignId))) {
    const campaign = store.campaigns.find((item) => item.id === offer.campaign_id);
    const lead = store.buyerLeads.find((item) => item.id === offer.buyer_lead_id);
    const policy = store.negotiationPolicies.find((item) => item.campaign_id === offer.campaign_id);
    if (!campaign || !lead || !policy) continue;

    const messages = store.outboundMessages.filter((message) => message.buyer_lead_id === lead.id);
    const events = store.conversationEvents.filter((event) => event.buyer_lead_id === lead.id);
    const actions = await ensurePostDepositHandoff({ campaign, lead, policy, offer, messages, events });
    results.push({ campaign_id: campaign.id, buyer_lead_id: lead.id, offer_id: offer.id, actions });
  }
  return results;
}
