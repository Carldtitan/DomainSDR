import { getFullCampaign, updateCampaign } from "@/lib/campaignStore";
import { saveToSupermemory } from "@/lib/supermemoryService";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await updateCampaign(id, { status: "closed" });
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });

  await saveToSupermemory({
    campaignId: campaign.id,
    type: "run_ended",
    content: JSON.stringify({ campaignId: campaign.id, domain: campaign.domain, ended_at: campaign.updated_at }, null, 2),
  });

  const full = await getFullCampaign(id);
  return Response.json({ ok: true, campaign, full });
}
