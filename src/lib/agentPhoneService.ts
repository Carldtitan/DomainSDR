import crypto from "node:crypto";
import { addConversationEvent, hasProcessedWebhookEvent, markProcessedWebhookEvent, updateLead } from "@/lib/campaignStore";
import { outboundPhoneRecipient } from "@/lib/contactRouting";
import { processInboundAgentMessage } from "@/lib/brokerAgentService";
import { saveToSupermemory } from "@/lib/supermemoryService";
import type { BuyerLead, DomainCampaign, NegotiationPolicy } from "@/lib/types";

const AGENTPHONE_BASE_URL = "https://api.agentphone.ai";

type AgentPhoneWebhook = {
  id?: string;
  type?: string;
  event?: string;
  callId?: string;
  conversationId?: string;
  messageId?: string;
  from?: string;
  to?: string;
  text?: string;
  transcript?: string;
  speech?: string;
  message?: { text?: string; body?: string; id?: string };
  call?: { id?: string; transcript?: string; status?: string };
  conversationState?: {
    campaignId?: string;
    leadId?: string;
    [key: string]: unknown;
  };
  metadata?: {
    campaignId?: string;
    leadId?: string;
    [key: string]: unknown;
  };
};

function configured() {
  return Boolean(process.env.AGENTPHONE_API_KEY);
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.AGENTPHONE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function allowExternalPhone(toNumber: string) {
  const controlled = outboundPhoneRecipient().replace(/\D/g, "");
  const target = toNumber.replace(/\D/g, "");
  return target === controlled || process.env.ALLOW_EXTERNAL_PHONE_OUTBOUND === "true";
}

function verifySignature(rawBody: string, signature?: string | null) {
  const secret = process.env.AGENTPHONE_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const clean = signature.replace(/^sha256=/, "");
  if (expected.length !== clean.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean));
}

function voiceSystemPrompt(campaign: DomainCampaign, lead: BuyerLead, policy: NegotiationPolicy) {
  return `You are DomainSDR, a careful domain broker agent representing ${campaign.owner_name}.

Domain: ${campaign.domain}
Buyer: ${lead.company_name}
Ask price: $${policy.ask_price}
Deposit amount: $${policy.deposit_amount}

Hard rules:
- Never reveal the seller floor price.
- Never accept below the seller floor.
- Never claim traffic, revenue, existing buyers, trademark safety, or legal clearance.
- If asked for legal/trademark assurance, recommend counsel and escrow/marketplace transfer.
- If they ask how to buy, quote the ask and say you can send a deposit link to confirm intent.
- If they ask for proof, offer TXT record, landing page verification, or escrow/marketplace verification.
- If they opt out, politely confirm and stop.

Style:
- Sound like a concise human broker.
- Keep each spoken answer under 45 seconds.
- Ask one clear next-step question at a time.`;
}

async function createHostedAgent(campaign: DomainCampaign, lead: BuyerLead, policy: NegotiationPolicy) {
  const response = await fetch(`${AGENTPHONE_BASE_URL}/v1/agents`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name: `DomainSDR ${campaign.domain}`,
      description: `Domain broker agent for ${campaign.domain}`,
      voiceMode: "hosted",
      systemPrompt: voiceSystemPrompt(campaign, lead, policy),
      beginMessage: `Hi, this is DomainSDR calling about ${campaign.domain}. Is now a reasonable time for a quick domain conversation?`,
      modelTier: "balanced",
      sttMode: "accurate",
      denoisingMode: "noise-cancellation",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) {
    throw new Error(data?.message || data?.error || `Could not create AgentPhone agent: ${response.status}`);
  }
  return data.id as string;
}

async function createNotificationAgent(campaign: DomainCampaign) {
  const response = await fetch(`${AGENTPHONE_BASE_URL}/v1/agents`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name: `DomainSDR updates ${campaign.domain}`,
      description: `Owner updates for ${campaign.domain}`,
      voiceMode: "hosted",
      systemPrompt: `Send concise owner updates for the ${campaign.domain} domain sale run. Do not negotiate with buyers from this agent.`,
      beginMessage: `DomainSDR update for ${campaign.domain}.`,
      modelTier: "fast",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) {
    throw new Error(data?.message || data?.error || `Could not create AgentPhone notification agent: ${response.status}`);
  }
  return data.id as string;
}

export async function startAgentPhoneCall({
  campaign,
  lead,
  policy,
  toNumber = outboundPhoneRecipient(),
}: {
  campaign: DomainCampaign;
  lead: BuyerLead;
  policy: NegotiationPolicy;
  toNumber?: string;
}) {
  if (!configured()) return { ok: false, error: "AGENTPHONE_API_KEY is not configured" };
  if (!allowExternalPhone(toNumber)) {
    return {
      ok: false,
      error: "External outbound calls are disabled. Use CONTACT_OVERRIDE_PHONE or set ALLOW_EXTERNAL_PHONE_OUTBOUND=true.",
    };
  }

  let agentId = process.env.AGENTPHONE_AGENT_ID;
  if (!agentId) {
    try {
      agentId = await createHostedAgent(campaign, lead, policy);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not create AgentPhone agent." };
    }
  }

  const body = {
    agentId,
    toNumber,
    initialGreeting: `Hi, this is DomainSDR calling about ${campaign.domain}. Is now a reasonable time for a quick domain conversation?`,
    systemPrompt: voiceSystemPrompt(campaign, lead, policy),
    metadata: {
      app: "DomainSDR",
      campaignId: campaign.id,
      leadId: lead.id,
      domain: campaign.domain,
      buyer: lead.company_name,
    },
  };

  try {
    const response = await fetch(`${AGENTPHONE_BASE_URL}/v1/calls`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: data?.message || data?.error || `AgentPhone ${response.status}`, data };
    }

    await addConversationEvent({
      campaign_id: campaign.id,
      buyer_lead_id: lead.id,
      channel: "phone",
      direction: "outbound",
      body: `AgentPhone call started to ${toNumber}.`,
      classification: "system_note",
      next_action: "Await call result.",
      external_call_id: data?.id || data?.callId,
      external_conversation_id: data?.conversationId,
    });
    await updateLead(lead.id, { status: "negotiating", next_action: "AgentPhone call in progress or queued." });
    await saveToSupermemory({
      campaignId: campaign.id,
      type: "agentphone_call_started",
      content: JSON.stringify({ lead, body, data }, null, 2),
    });

    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown AgentPhone error" };
  }
}

export async function sendOwnerSmsUpdate({
  campaign,
  body,
  type = "owner_sms_update",
}: {
  campaign: DomainCampaign;
  body: string;
  type?: string;
}) {
  if (!configured()) return { ok: false, skipped: true, error: "AGENTPHONE_API_KEY is not configured" };
  let agentId = process.env.AGENTPHONE_AGENT_ID;
  if (!agentId) {
    try {
      agentId = await createNotificationAgent(campaign);
    } catch (error) {
      return { ok: false, skipped: true, error: error instanceof Error ? error.message : "Could not create notification agent" };
    }
  }

  const toNumber = outboundPhoneRecipient();
  if (!allowExternalPhone(toNumber)) {
    return { ok: false, skipped: true, error: "External owner SMS is disabled." };
  }

  const message = body.trim().slice(0, 320);
  if (!message) return { ok: false, skipped: true, error: "SMS body is empty" };

  try {
    const response = await fetch(`${AGENTPHONE_BASE_URL}/v1/messages`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        agent_id: agentId,
        to_number: toNumber,
        body: message,
      }),
    });
    const data = await response.json().catch(() => ({}));
    const ok = response.ok;

    await saveToSupermemory({
      campaignId: campaign.id,
      type,
      content: JSON.stringify({ toNumber, body: message, ok, data }, null, 2),
    });

    return ok
      ? { ok: true, data }
      : { ok: false, skipped: false, error: data?.message || data?.error || `AgentPhone ${response.status}`, data };
  } catch (error) {
    return { ok: false, skipped: false, error: error instanceof Error ? error.message : "Unknown AgentPhone error" };
  }
}

function webhookText(payload: AgentPhoneWebhook) {
  return (
    payload.text ||
    payload.transcript ||
    payload.speech ||
    payload.message?.text ||
    payload.message?.body ||
    payload.call?.transcript ||
    ""
  ).trim();
}

function webhookId(payload: AgentPhoneWebhook) {
  return payload.id || payload.messageId || payload.message?.id || payload.callId || payload.call?.id || crypto.randomUUID();
}

export async function handleAgentPhoneWebhook(rawBody: string, signature?: string | null) {
  if (!verifySignature(rawBody, signature)) {
    return { status: 401, body: { error: "Invalid AgentPhone signature" } };
  }

  const payload = JSON.parse(rawBody || "{}") as AgentPhoneWebhook;
  const id = webhookId(payload);
  if (await hasProcessedWebhookEvent(id)) {
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  const text = webhookText(payload);
  await markProcessedWebhookEvent(id);

  if (!text) {
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const result = await processInboundAgentMessage({
    body: text,
    channel: payload.type?.toLowerCase().includes("sms") || payload.event?.toLowerCase().includes("sms") ? "sms" : "phone",
    campaignId: payload.metadata?.campaignId || payload.conversationState?.campaignId,
    leadId: payload.metadata?.leadId || payload.conversationState?.leadId,
    externalMessageId: payload.messageId || payload.message?.id,
    externalConversationId: payload.conversationId,
    externalCallId: payload.callId || payload.call?.id,
  });

  return {
    status: result.ok ? 200 : 422,
    body: {
      ok: result.ok,
      text: result.responseText,
      response: result.responseText,
      conversationState: {
        campaignId: result.campaign?.id,
        leadId: result.lead?.id,
      },
      error: result.error,
    },
  };
}
