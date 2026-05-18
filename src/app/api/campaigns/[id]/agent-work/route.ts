import { runAgentTick } from "@/lib/agentOrchestrator";
import { getFullCampaign } from "@/lib/campaignStore";
import { buildAgentRunState } from "@/lib/agentRunState";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  await runAgentTick({
    campaignId: id,
    forceResearch: false,
    discoverBuyers: true,
    sendFirstTouch: true,
    sendNegotiationReplies: true,
    sendFollowUps: true,
    makePhoneCalls: true,
    minLeadsPerCampaign: 25,
    minReachablePerCampaign: 5,
    maxLeadPoolPerCampaign: 40,
    minHoursBetweenResearch: 0.1,
    maxDraftsPerTick: 10,
    maxContactEnrichmentPerTick: 6,
    maxFirstTouchSendsPerTick: 5,
    maxFollowUpsPerTick: 3,
    maxCallsPerTick: 2,
    maxDailySends: 15,
  });

  const full = await getFullCampaign(id);
  if (!full) return Response.json({ error: "Campaign not found" }, { status: 404 });
  return Response.json(buildAgentRunState(full));
}
