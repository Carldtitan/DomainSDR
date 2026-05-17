import { addOffer, updateOffer } from "@/lib/campaignStore";
import type { BuyerLead, DomainCampaign } from "@/lib/types";

function appBaseUrl() {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}

async function createStripeCheckout(campaign: DomainCampaign, buyer: BuyerLead, amount: number, depositAmount: number) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return undefined;

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${appBaseUrl()}/checkout/success?session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${appBaseUrl()}/campaign/${campaign.id}/conversation/${buyer.id}`);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(Math.round(depositAmount * 100)));
  params.set("line_items[0][price_data][product_data][name]", `Intent deposit for ${campaign.domain}`);
  params.set("metadata[campaign_id]", campaign.id);
  params.set("metadata[buyer_lead_id]", buyer.id);
  params.set("metadata[accepted_amount]", String(amount));

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!response.ok) return undefined;
  const data = (await response.json()) as { url?: string };
  return data.url;
}

export async function createDepositLink(campaign: DomainCampaign, buyer: BuyerLead, amount: number) {
  const mockLink = `${appBaseUrl()}/checkout/pending`;
  const offer = await addOffer({
    campaign_id: campaign.id,
    buyer_lead_id: buyer.id,
    amount,
    status: "deposit_requested",
    payment_link: mockLink,
  });

  const stripeUrl = await createStripeCheckout(campaign, buyer, amount, campaign.deposit_amount).catch(() => undefined);
  const paymentLink = stripeUrl || `${appBaseUrl()}/checkout/${offer.id}`;
  const updated = await updateOffer(offer.id, { payment_link: paymentLink });
  return updated || offer;
}
