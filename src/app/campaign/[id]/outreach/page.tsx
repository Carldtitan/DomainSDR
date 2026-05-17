import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { OutreachReviewClient } from "@/components/OutreachReviewClient";
import { getFullCampaign } from "@/lib/campaignStore";
import { outboundEmailRecipient } from "@/lib/contactRouting";

export const dynamic = "force-dynamic";

export default async function OutreachPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const full = await getFullCampaign(id);
  if (!full) notFound();

  return (
    <AppShell campaign={full.campaign} active="outreach">
      <OutreachReviewClient full={full} defaultRecipient={outboundEmailRecipient()} />
    </AppShell>
  );
}
