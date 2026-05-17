import { addSuppression, getFullCampaign, getLead, updateLead } from "@/lib/campaignStore";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const lead = await getLead(id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

  await addSuppression({
    campaign_id: lead.campaign_id,
    buyer_lead_id: lead.id,
    email: lead.contact_email,
    reason: "manual_opt_out",
  });
  const updated = await updateLead(id, { status: "opted_out", next_action: "Suppressed" });
  const full = await getFullCampaign(lead.campaign_id);
  return Response.json({ lead: updated, campaign: full?.campaign });
}
