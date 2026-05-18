import { runAgentTick } from "@/lib/agentOrchestrator";
import { getFullCampaign } from "@/lib/campaignStore";
import { buildAgentRunState } from "@/lib/agentRunState";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  await runAgentTick({
    campaignId: id,
    forceResearch: true,
    discoverBuyers: true,
    sendFirstTouch: true,
    sendNegotiationReplies: true,
    sendFollowUps: true,
    makePhoneCalls: true,
    minLeadsPerCampaign: 12,
    minHoursBetweenResearch: 2,
    maxDraftsPerTick: 5,
    maxFirstTouchSendsPerTick: 2,
    maxFollowUpsPerTick: 1,
    maxDailySends: 5,
  });

  const full = await getFullCampaign(id);
  if (!full) return Response.json({ error: "Campaign not found" }, { status: 404 });
  return Response.json(buildAgentRunState(full));
}
