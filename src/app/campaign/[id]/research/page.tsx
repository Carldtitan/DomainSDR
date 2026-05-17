import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BuyerResearchClient } from "@/components/BuyerResearchClient";
import { getFullCampaign } from "@/lib/campaignStore";

export const dynamic = "force-dynamic";

export default async function ResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const full = await getFullCampaign(id);
  if (!full) notFound();

  return (
    <AppShell campaign={full.campaign} active="research">
      <BuyerResearchClient full={full} />
    </AppShell>
  );
}
