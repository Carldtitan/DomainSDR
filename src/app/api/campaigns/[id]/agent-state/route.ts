import { getFullCampaign } from "@/lib/campaignStore";
import { buildAgentRunState } from "@/lib/agentRunState";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const full = await getFullCampaign(id);
  if (!full) return Response.json({ error: "Campaign not found" }, { status: 404 });
  return Response.json(buildAgentRunState(full));
}
