import { replyWithAgentMail } from "@/lib/agentMailService";
import { addConversationEvent, getConversationEvent, getFullCampaign, updateLead } from "@/lib/campaignStore";
import { saveToSupermemory } from "@/lib/supermemoryService";

export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { body?: string };
  const event = await getConversationEvent(eventId);
  if (!event) return Response.json({ error: "Event not found" }, { status: 404 });

  const full = await getFullCampaign(event.campaign_id);
  const lead = full?.leads.find((item) => item.id === event.buyer_lead_id);
  if (!full || !lead) return Response.json({ error: "Campaign or lead not found" }, { status: 404 });

  const responseBody = body.body || event.suggested_response;
  if (!responseBody) return Response.json({ error: "No response body available" }, { status: 400 });

  const sent = await replyWithAgentMail(event.agentmail_message_id, responseBody);
  const outbound = await addConversationEvent({
    campaign_id: event.campaign_id,
    buyer_lead_id: event.buyer_lead_id,
    channel: "email",
    direction: "outbound",
    body: responseBody,
    classification: "sent_email",
    next_action: "Await buyer response",
    agentmail_message_id: sent.message_id,
    agentmail_thread_id: sent.thread_id,
  });

  await updateLead(lead.id, { status: "negotiating", next_action: "Await buyer response" });
  await saveToSupermemory({
    campaignId: full.campaign.id,
    type: "negotiation_response",
    content: JSON.stringify({ lead, responseBody, sent }, null, 2),
  });

  return Response.json({ event: outbound, sent });
}
