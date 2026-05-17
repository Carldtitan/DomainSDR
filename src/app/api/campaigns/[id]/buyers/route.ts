import { discoverBuyers } from "@/lib/apifyService";
import { getFullCampaign, updateCampaign, upsertLeads } from "@/lib/campaignStore";
import { analyzeDomain } from "@/lib/llmService";
import { saveToSupermemory } from "@/lib/supermemoryService";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const full = await getFullCampaign(id);
  if (!full) return Response.json({ error: "Campaign not found" }, { status: 404 });

  await updateCampaign(id, { status: "researching" });
  const analysis = full.campaign.analysis || (await analyzeDomain(full.campaign.domain, full.campaign.use_case_thesis));
  if (!full.campaign.analysis) await updateCampaign(id, { analysis });

  const discovered = await discoverBuyers(full.campaign, analysis);
  const leads = await upsertLeads(id, discovered);

  await saveToSupermemory({
    campaignId: id,
    type: "buyer_research",
    content: JSON.stringify({ analysis, leads }, null, 2),
  });

  return Response.json({ leads });
}
