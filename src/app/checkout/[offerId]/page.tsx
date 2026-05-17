import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CheckoutClient } from "@/components/CheckoutClient";
import { getFullCampaign, getOffer } from "@/lib/campaignStore";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const offer = await getOffer(offerId);
  if (!offer) notFound();
  const full = await getFullCampaign(offer.campaign_id);
  if (!full) notFound();

  return (
    <AppShell campaign={full.campaign} active="dashboard">
      <CheckoutClient offer={offer} domain={full.campaign.domain} />
    </AppShell>
  );
}
