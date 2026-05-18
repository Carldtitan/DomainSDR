import { AppShell } from "@/components/AppShell";
import { IntakeForm } from "@/components/IntakeForm";
import { RunBoard } from "@/components/RunBoard";
import { getFullCampaign, listCampaigns } from "@/lib/campaignStore";
import type { FullCampaign } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const campaigns = await listCampaigns();
  const loadedRuns = await Promise.all(campaigns.slice(0, 8).map((campaign) => getFullCampaign(campaign.id)));
  const runs = loadedRuns.filter((run): run is FullCampaign => Boolean(run));

  return (
    <AppShell>
      <div className="grid gap-4 lg:h-[calc(100vh-96px)] lg:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)] lg:overflow-hidden">
        <IntakeForm />
        <RunBoard runs={runs} />
      </div>
    </AppShell>
  );
}
