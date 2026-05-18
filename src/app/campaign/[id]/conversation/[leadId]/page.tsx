import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ConversationClient } from "@/components/ConversationClient";
import { getFullCampaign } from "@/lib/campaignStore";
import { createOwnershipProof } from "@/lib/ownershipProof";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string; leadId: string }>;
}) {
  const { id, leadId } = await params;
  const full = await getFullCampaign(id);
  if (!full) notFound();
  const lead = full.leads.find((item) => item.id === leadId);
  if (!lead) notFound();

  return (
    <AppShell campaign={full.campaign}>
      <ConversationClient
        campaign={full.campaign}
        lead={lead}
        events={full.events.filter((event) => event.buyer_lead_id === leadId)}
        offers={full.offers.filter((offer) => offer.buyer_lead_id === leadId)}
        ownershipProof={createOwnershipProof(full.campaign, lead)}
      />
    </AppShell>
  );
}
