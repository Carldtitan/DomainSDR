import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AgentRunClient } from "@/components/AgentRunClient";
import { getFullCampaign } from "@/lib/campaignStore";
import { buildAgentRunState } from "@/lib/agentRunState";

export const dynamic = "force-dynamic";

export default async function AgentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const full = await getFullCampaign(id);
  if (!full) notFound();

  return (
    <AppShell campaign={full.campaign}>
      <AgentRunClient initialState={buildAgentRunState(full)} />
    </AppShell>
  );
}
