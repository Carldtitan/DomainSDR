import { AppShell } from "@/components/AppShell";
import { IntakeForm } from "@/components/IntakeForm";
import { listCampaigns } from "@/lib/campaignStore";

export const dynamic = "force-dynamic";

export default async function Home() {
  const campaigns = await listCampaigns();
  return (
    <AppShell active="intake">
      <IntakeForm campaigns={campaigns} />
    </AppShell>
  );
}
