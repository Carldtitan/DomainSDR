import { addOffer, updateOffer } from "@/lib/campaignStore";
import { getStripe } from "@/lib/stripeClient";
import type { BuyerLead, DomainCampaign } from "@/lib/types";

function appBaseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function createStripeCheckout(
  campaign: DomainCampaign,
  buyer: BuyerLead,
  offerId: string,
  acceptedAmount: number,
  depositAmount: number,
) {
  const stripe = getStripe();
  if (!stripe) return undefined;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${appBaseUrl()}/checkout/${offerId}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appBaseUrl()}/campaign/${campaign.id}/conversation/${buyer.id}`,
    client_reference_id: offerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.max(100, Math.round(depositAmount * 100)),
          product_data: {
            name: `Intent deposit for ${campaign.domain}`,
            description: `Deposit toward accepted domain sale amount of $${acceptedAmount}. Transfer should use escrow or a trusted marketplace.`,
          },
        },
      },
    ],
    metadata: {
      offer_id: offerId,
      campaign_id: campaign.id,
      buyer_lead_id: buyer.id,
      accepted_amount: String(acceptedAmount),
      domain: campaign.domain,
    },
  });

  return session.url || undefined;
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

  const stripeUrl = await createStripeCheckout(campaign, buyer, offer.id, amount, campaign.deposit_amount).catch(() => undefined);
  const paymentLink = stripeUrl || `${appBaseUrl()}/checkout/${offer.id}`;
  const updated = await updateOffer(offer.id, { payment_link: paymentLink });
  return updated || offer;
}
