import { addConversationEvent, getFullCampaign, getOffer, updateCampaign, updateLead, updateOffer } from "@/lib/campaignStore";
import { ensurePostDepositHandoff } from "@/lib/postDepositService";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const offer = await getOffer(id);
  if (!offer) return Response.json({ error: "Offer not found" }, { status: 404 });
  const updated = await updateOffer(id, { status: "deposit_paid" });
  const full = await getFullCampaign(offer.campaign_id);
  const lead = full?.leads.find((item) => item.id === offer.buyer_lead_id);
  let handoff;
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
    const refreshed = await getFullCampaign(full.campaign.id);
    const refreshedLead = refreshed?.leads.find((item) => item.id === lead.id);
    const refreshedOffer = refreshed?.offers.find((item) => item.id === offer.id) || updated || offer;
    if (refreshed && refreshedLead && refreshed.policy) {
      handoff = await ensurePostDepositHandoff({
        campaign: refreshed.campaign,
        lead: refreshedLead,
        policy: refreshed.policy,
        offer: refreshedOffer,
        messages: refreshed.messages.filter((message) => message.buyer_lead_id === refreshedLead.id),
        events: refreshed.events.filter((event) => event.buyer_lead_id === refreshedLead.id),
      });
    }
  }
  return Response.json({ offer: updated, handoff });
}
