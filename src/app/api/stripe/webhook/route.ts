import Stripe from "stripe";
import {
  addConversationEvent,
  getFullCampaign,
  getOffer,
  hasProcessedWebhookEvent,
  markProcessedWebhookEvent,
  updateCampaign,
  updateLead,
  updateOffer,
} from "@/lib/campaignStore";
import { money } from "@/lib/format";
import { saveToSupermemory } from "@/lib/supermemoryService";
import { getStripe } from "@/lib/stripeClient";

export const runtime = "nodejs";

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const offerId = session.metadata?.offer_id || session.client_reference_id;
  if (!offerId) return { skipped: true, reason: "No offer_id metadata" };

  const offer = await getOffer(offerId);
  if (!offer) return { skipped: true, reason: "Offer not found" };

  const updatedOffer = await updateOffer(offer.id, { status: "deposit_paid" });
  const full = await getFullCampaign(offer.campaign_id);
  const lead = full?.leads.find((item) => item.id === offer.buyer_lead_id);
  if (!full || !lead) return { skipped: true, reason: "Campaign or lead not found" };

  await updateLead(lead.id, {
    status: "deposit_requested",
    next_action: "Deposit paid. Set up escrow or trusted marketplace transfer.",
  });
  await updateCampaign(full.campaign.id, { status: "deposit_requested" });
  const event = await addConversationEvent({
    campaign_id: full.campaign.id,
    buyer_lead_id: lead.id,
    channel: "manual",
    direction: "inbound",
    body: `Stripe deposit paid for ${full.campaign.domain}. Deposit: ${money(full.campaign.deposit_amount)}. Accepted sale amount: ${money(offer.amount)}.`,
    classification: "system_note",
    offer_amount: offer.amount,
    next_action: "Set up escrow or trusted marketplace transfer.",
  });

  await saveToSupermemory({
    campaignId: full.campaign.id,
    type: "stripe_deposit_paid",
    customId: `stripe_${session.id}`,
    content: JSON.stringify({ offer: updatedOffer, lead, sessionId: session.id, event }, null, 2),
  });

  return { offer: updatedOffer, event };
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");

  if (!stripe || !webhookSecret) {
    return Response.json({ error: "Stripe webhook is not configured" }, { status: 400 });
  }
  if (!signature) {
    return Response.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid Stripe webhook signature" },
      { status: 400 },
    );
  }

  if (await hasProcessedWebhookEvent(event.id)) {
    return Response.json({ received: true, duplicate: true });
  }

  let result: unknown = { ignored: true, type: event.type };
  if (event.type === "checkout.session.completed") {
    result = await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
  }

  await markProcessedWebhookEvent(event.id);
  return Response.json({ received: true, result });
}
