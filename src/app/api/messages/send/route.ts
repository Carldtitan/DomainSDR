import {
  addConversationEvent,
  getFullCampaign,
  getOutboundMessage,
  isSuppressed,
  updateCampaign,
  updateLead,
  updateOutboundMessage,
} from "@/lib/campaignStore";
import { sendEmailWithAgentMail } from "@/lib/agentMailService";
import { outboundEmailRecipient } from "@/lib/contactRouting";
import { saveToSupermemory } from "@/lib/supermemoryService";

type SendOverride = {
  subject?: string;
  body?: string;
  to?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as {
    messageIds?: string[];
    overrides?: Record<string, SendOverride>;
  };

  const messageIds = (body.messageIds || []).slice(0, 5);
  if (messageIds.length === 0) {
    return Response.json({ error: "Select at least one message." }, { status: 400 });
  }

  const results = [];
  for (const messageId of messageIds) {
    const message = await getOutboundMessage(messageId);
    if (!message) {
      results.push({ id: messageId, ok: false, error: "Message not found" });
      continue;
    }

    const full = await getFullCampaign(message.campaign_id);
    const lead = full?.leads.find((item) => item.id === message.buyer_lead_id);
    if (!full || !lead) {
      results.push({ id: messageId, ok: false, error: "Campaign or lead not found" });
      continue;
    }

    const override = body.overrides?.[messageId] ?? {};
    const to = outboundEmailRecipient();
    if (!to) {
      results.push({ id: messageId, ok: false, error: "No recipient. Add a test recipient email." });
      continue;
    }

    if (await isSuppressed(full.campaign.id, lead.id, to)) {
      results.push({ id: messageId, ok: false, error: "Lead is suppressed by opt-out." });
      continue;
    }

    const subject = override.subject || message.subject;
    const text = override.body || message.body;
    const sent = await sendEmailWithAgentMail(to, subject, text);
    await updateOutboundMessage(messageId, {
      subject,
      body: text,
      to_email: to,
      status: sent.message_id ? "sent" : "failed",
      agentmail_message_id: sent.message_id,
      agentmail_thread_id: sent.thread_id,
      sent_at: new Date().toISOString(),
      error: sent.error,
    });
    await updateLead(lead.id, { status: "sent", next_action: "Await reply" });
    if (["draft", "analyzed", "ready_for_outreach"].includes(full.campaign.status)) {
      await updateCampaign(full.campaign.id, { status: "outreach_active" });
    }
    await addConversationEvent({
      campaign_id: full.campaign.id,
      buyer_lead_id: lead.id,
      channel: "email",
      direction: "outbound",
      body: text,
      classification: "sent_email",
      next_action: "Await reply",
      agentmail_message_id: sent.message_id,
      agentmail_thread_id: sent.thread_id,
    });

    await saveToSupermemory({
      campaignId: full.campaign.id,
      type: "email_sent",
      content: JSON.stringify({ lead, subject, text, to, sent }, null, 2),
    });

    results.push({ id: messageId, ok: Boolean(sent.message_id), sent });
  }

  return Response.json({ results });
}
