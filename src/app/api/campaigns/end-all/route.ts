import { endActiveCampaigns } from "@/lib/campaignStore";
import { saveWorkspaceSnapshot } from "@/lib/supermemoryService";

export const dynamic = "force-dynamic";

export async function POST() {
  const ended = await endActiveCampaigns();

  await saveWorkspaceSnapshot(
    JSON.stringify(
      {
        type: "all_runs_ended",
        ended_at: new Date().toISOString(),
        ended: ended.map((campaign) => ({
          id: campaign.id,
          domain: campaign.domain,
          status: campaign.status,
        })),
      },
      null,
      2,
    ),
  );

  return Response.json({ ok: true, ended });
}
