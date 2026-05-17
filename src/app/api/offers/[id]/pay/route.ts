import { addConversationEvent, getFullCampaign, getOffer, updateCampaign, updateLead, updateOffer } from "@/lib/campaignStore";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const offer = await getOffer(id);
  if (!offer) return Response.json({ error: "Offer not found" }, { status: 404 });
  const updated = await updateOffer(id, { status: "deposit_paid" });
  const full = await getFullCampaign(offer.campaign_id);
  const lead = full?.leads.find((item) => item.id === offer.buyer_lead_id);
  if (full && lead) {
    await updateLead(lead.id, { status: "deposit_requested", next_action: "Deposit paid. Escrow transfer next." });
    await addConversationEvent({
      campaign_id: full.campaign.id,
      buyer_lead_id: lead.id,
      channel: "manual",
      direction: "inbound",
      body: `Mock deposit paid for ${full.campaign.domain}.`,
      classification: "system_note",
      offer_amount: offer.amount,
      next_action: "Set up escrow or trusted marketplace transfer.",
    });
    await updateCampaign(full.campaign.id, { status: "deposit_requested" });
  }
  return Response.json({ offer: updated });
}
