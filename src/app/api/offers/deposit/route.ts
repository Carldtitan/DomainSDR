import { replyWithAgentMail } from "@/lib/agentMailService";
import { addConversationEvent, getConversationEvent, getFullCampaign, updateLead } from "@/lib/campaignStore";
import { money } from "@/lib/format";
import { createDepositLink } from "@/lib/paymentService";
import { saveToSupermemory } from "@/lib/supermemoryService";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    campaignId?: string;
    leadId?: string;
    amount?: number;
    eventId?: string;
    send?: boolean;
  };
  if (!body.campaignId || !body.leadId) {
    return Response.json({ error: "campaignId and leadId are required" }, { status: 400 });
  }

  const full = await getFullCampaign(body.campaignId);
  const lead = full?.leads.find((item) => item.id === body.leadId);
  if (!full || !lead) return Response.json({ error: "Campaign or lead not found" }, { status: 404 });

  const amount = Number(body.amount || full.campaign.ask_price);
  if (amount < full.campaign.floor_price) {
    return Response.json({ error: "Cannot request deposit for an amount below seller floor." }, { status: 400 });
  }

  const offer = await createDepositLink(full.campaign, lead, amount);
  const responseBody = `Here is the ${money(full.campaign.deposit_amount)} deposit link for ${full.campaign.domain}: ${offer?.payment_link}

This deposit confirms intent only. The domain transfer should still run through escrow or a trusted marketplace.

${full.campaign.owner_name}`;

  let sent;
  if (body.send && body.eventId) {
    const event = await getConversationEvent(body.eventId);
    sent = await replyWithAgentMail(event?.agentmail_message_id, responseBody);
  }

  const outbound = await addConversationEvent({
    campaign_id: full.campaign.id,
    buyer_lead_id: lead.id,
    channel: "email",
    direction: "outbound",
    body: responseBody,
    classification: "sent_email",
    offer_amount: amount,
    next_action: "Deposit requested",
    agentmail_message_id: sent?.message_id,
    agentmail_thread_id: sent?.thread_id,
  });
  await updateLead(lead.id, { status: "deposit_requested", next_action: "Await deposit" });

  await saveToSupermemory({
    campaignId: full.campaign.id,
    type: "deposit_requested",
    content: JSON.stringify({ lead, offer, responseBody, sent }, null, 2),
  });

  return Response.json({ offer, event: outbound, sent });
}
