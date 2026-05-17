import {
  addConversationEvent,
  addSuppression,
  hasProcessedAgentmailMessage,
  loadStore,
  markProcessedAgentmailMessage,
  updateLead,
} from "@/lib/campaignStore";
import { classifyReply } from "@/lib/llmService";
import { generateNegotiationReply } from "@/lib/negotiationEngine";
import { reconcileLeadFromReplyBody } from "@/lib/leadIdentity";
import type { BuyerLead, DomainCampaign, NegotiationPolicy } from "@/lib/types";
import type { OutboundMessage } from "@/lib/types";

const AGENTMAIL_BASE_URL = "https://api.agentmail.to/v0";

type AgentMailSendResult = {
  ok: boolean;
  message_id?: string;
  thread_id?: string;
  error?: string;
};

export type AgentMailMessage = {
  inbox_id: string;
  thread_id?: string;
  message_id: string;
  labels?: string[];
  timestamp?: string;
  from?: string | string[];
  from_?: string[];
  to?: string[];
  subject?: string;
  preview?: string;
  text?: string;
  extracted_text?: string;
  html?: string;
  extracted_html?: string;
  in_reply_to?: string;
  references?: string[];
};

function configured() {
  return Boolean(process.env.AGENTMAIL_API_KEY && process.env.AGENTMAIL_INBOX_ID);
}

function realEmailAllowed() {
  const flag = process.env.ALLOW_REAL_EMAIL_SEND;
  return flag !== "false" && flag !== "0";
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.AGENTMAIL_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function inboxPath() {
  return encodeURIComponent(process.env.AGENTMAIL_INBOX_ID ?? "");
}

export async function sendEmailWithAgentMail(to: string, subject: string, body: string): Promise<AgentMailSendResult> {
  if (!configured()) {
    return {
      ok: false,
      message_id: `mock_${crypto.randomUUID().slice(0, 8)}`,
      thread_id: `mock_thread_${crypto.randomUUID().slice(0, 8)}`,
      error: "AgentMail env vars are not configured; stored as mock send.",
    };
  }

  if (!realEmailAllowed()) {
    return {
      ok: false,
      message_id: `mock_${crypto.randomUUID().slice(0, 8)}`,
      thread_id: `mock_thread_${crypto.randomUUID().slice(0, 8)}`,
      error: "ALLOW_REAL_EMAIL_SEND is disabled; stored as mock send.",
    };
  }

  try {
    const response = await fetch(`${AGENTMAIL_BASE_URL}/inboxes/${inboxPath()}/messages/send`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        to,
        subject,
        text: body,
        labels: ["domainsdr", "outreach"],
      }),
    });

    const data = (await response.json().catch(() => ({}))) as { message_id?: string; thread_id?: string; detail?: string };
    if (!response.ok) {
      return { ok: false, error: data.detail || `AgentMail ${response.status}` };
    }

    return { ok: true, message_id: data.message_id, thread_id: data.thread_id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown AgentMail error" };
  }
}

export async function replyWithAgentMail(messageId: string | undefined, body: string): Promise<AgentMailSendResult> {
  if (!messageId || messageId.startsWith("mock_")) {
    return {
      ok: false,
      message_id: `mock_reply_${crypto.randomUUID().slice(0, 8)}`,
      thread_id: `mock_thread_${crypto.randomUUID().slice(0, 8)}`,
      error: "No real AgentMail message to reply to; stored as manual outbound.",
    };
  }

  if (!configured() || !realEmailAllowed()) {
    return {
      ok: false,
      message_id: `mock_reply_${crypto.randomUUID().slice(0, 8)}`,
      error: "AgentMail reply skipped by configuration.",
    };
  }

  try {
    const response = await fetch(`${AGENTMAIL_BASE_URL}/inboxes/${inboxPath()}/messages/${encodeURIComponent(messageId)}/reply`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        text: body,
        labels: ["domainsdr", "negotiation"],
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { message_id?: string; thread_id?: string; detail?: string };
    if (!response.ok) return { ok: false, error: data.detail || `AgentMail ${response.status}` };
    return { ok: true, message_id: data.message_id, thread_id: data.thread_id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown AgentMail error" };
  }
}

async function listUnreadMessages() {
  if (!configured() || !realEmailAllowed()) return [];

  const url = new URL(`${AGENTMAIL_BASE_URL}/inboxes/${inboxPath()}/messages`);
  url.searchParams.set("limit", "25");
  url.searchParams.append("labels", "unread");
  url.searchParams.set("include_unauthenticated", "true");

  const response = await fetch(url, { headers: headers() });
  if (!response.ok) return [];

  const data = (await response.json()) as { messages?: AgentMailMessage[] };
  return data.messages ?? [];
}

async function getMessage(messageId: string) {
  const response = await fetch(`${AGENTMAIL_BASE_URL}/inboxes/${inboxPath()}/messages/${encodeURIComponent(messageId)}`, {
    headers: headers(),
  });
  if (!response.ok) return undefined;
  return (await response.json()) as AgentMailMessage;
}

async function markMessageRead(messageId: string) {
  if (!configured() || !realEmailAllowed()) return;
  await fetch(`${AGENTMAIL_BASE_URL}/inboxes/${inboxPath()}/messages/${encodeURIComponent(messageId)}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ add_labels: ["read", "domainsdr-processed"], remove_labels: ["unread"] }),
  }).catch(() => undefined);
}

function messageBody(message: AgentMailMessage) {
  return message.extracted_text || message.text || message.preview || message.extracted_html || message.html || "";
}

function emailAddress(value?: string) {
  const match = value?.match(/<([^>]+)>/);
  return (match?.[1] || value || "").toLowerCase();
}

function emailList(values?: string[]) {
  return (values || []).map(emailAddress).filter(Boolean);
}

function firstSender(message: AgentMailMessage) {
  const from = Array.isArray(message.from) ? message.from[0] : message.from;
  return from || message.from_?.[0] || "";
}

function normalizedSubject(value?: string) {
  return (value || "")
    .toLowerCase()
    .replace(/^\s*(re|fw|fwd):\s*/i, "")
    .trim();
}

function matchLead(
  message: AgentMailMessage,
  campaigns: DomainCampaign[],
  leads: BuyerLead[],
  policies: NegotiationPolicy[],
  outboundMessages: OutboundMessage[],
) {
  const references = new Set([message.in_reply_to, ...(message.references ?? [])].filter(Boolean));
  const from = emailAddress(firstSender(message));
  const recipients = emailList(message.to);
  const subject = normalizedSubject(message.subject);

  const threadOutbound = outboundMessages.find(
    (outbound) => message.thread_id && outbound.agentmail_thread_id === message.thread_id,
  );
  if (threadOutbound) return leads.find((lead) => lead.id === threadOutbound.buyer_lead_id);

  const referencedOutbound = outboundMessages.find((outbound) => {
    return (
      (outbound.agentmail_message_id && references.has(outbound.agentmail_message_id)) ||
      (message.in_reply_to && outbound.agentmail_message_id === message.in_reply_to)
    );
  });
  if (referencedOutbound) return leads.find((lead) => lead.id === referencedOutbound.buyer_lead_id);

  const scored = leads
    .map((lead) => {
      const campaign = campaigns.find((item) => item.id === lead.campaign_id);
      const campaignMessages = outboundMessages.filter((item) => item.buyer_lead_id === lead.id);
      let score = 0;

      if (lead.contact_email && from === lead.contact_email.toLowerCase()) score += 75;
      if (campaign && subject.includes(campaign.domain.toLowerCase())) score += 45;
      if (campaignMessages.some((outbound) => outbound.to_email && from === outbound.to_email.toLowerCase())) score += 35;
      if (campaignMessages.some((outbound) => outbound.to_email && recipients.includes(outbound.to_email.toLowerCase()))) score += 15;
      if (campaignMessages.some((outbound) => normalizedSubject(outbound.subject) === subject)) score += 30;
      if (campaignMessages.some((outbound) => outbound.status === "sent")) score += 10;
      if (policies.some((policy) => policy.campaign_id === lead.campaign_id)) score += 5;

      return { lead, score };
    })
    .filter((item) => item.score >= 45)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return undefined;
  if (scored.length > 1 && scored[0].score === scored[1].score) return undefined;
  return scored[0].lead;
}

export async function processAgentMailMessage(input: AgentMailMessage) {
  if (await hasProcessedAgentmailMessage(input.message_id)) return undefined;

  const store = await loadStore();
  const message = (await getMessage(input.message_id)) || input;
  const matchedLead = matchLead(message, store.campaigns, store.buyerLeads, store.negotiationPolicies, store.outboundMessages);
  if (!matchedLead) return undefined;

  const body = messageBody(message);
  const lead = reconcileLeadFromReplyBody(body, matchedLead, store.buyerLeads);
  const campaign = store.campaigns.find((item) => item.id === lead.campaign_id);
  const policy = store.negotiationPolicies.find((item) => item.campaign_id === lead.campaign_id);
  if (!campaign || !policy) return undefined;

  const classification = await classifyReply(body);
  const draft = generateNegotiationReply(campaign, lead, { ...classification, body }, policy);

  const event = await addConversationEvent({
    campaign_id: campaign.id,
    buyer_lead_id: lead.id,
    channel: "email",
    direction: "inbound",
    body,
    classification: classification.classification,
    offer_amount: classification.offer_amount,
    urgency: classification.urgency,
    next_action: draft.next_action,
    suggested_response: draft.body,
    agentmail_message_id: message.message_id,
    agentmail_thread_id: message.thread_id,
  });

  if (draft.should_suppress) {
    await addSuppression({
      campaign_id: campaign.id,
      buyer_lead_id: lead.id,
      email: lead.contact_email || emailAddress(firstSender(message)),
      reason: classification.classification,
    });
    await updateLead(lead.id, { status: "opted_out", next_action: "Suppressed" });
  } else if (draft.should_escalate) {
    await updateLead(lead.id, { status: "escalated", next_action: draft.next_action });
  }

  await markProcessedAgentmailMessage(message.message_id);
  await markMessageRead(message.message_id);
  return event;
}

export async function pollAgentMailReplies() {
  const messages = await listUnreadMessages();
  const processed = [];

  for (const listed of messages) {
    const event = await processAgentMailMessage(listed);
    if (event) processed.push(event);
  }

  return processed;
}
