import { createCampaign } from "@/lib/campaignStore";
import { saveToSupermemory } from "@/lib/supermemoryService";

export const maxDuration = 60;

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: unknown) {
  return value === true || value === "true" || value === "on";
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const domain = String(body.domain || "").trim();
  if (!domain) {
    return Response.json({ error: "Domain is required" }, { status: 400 });
  }

  const askPrice = numberValue(body.ask_price);
  const floorPrice = numberValue(body.floor_price);
  if (askPrice <= 0 || floorPrice <= 0 || floorPrice > askPrice) {
    return Response.json({ error: "Ask price and floor price must be valid, with floor at or below ask." }, { status: 400 });
  }

  const useCaseThesis = String(body.use_case_thesis || "");
  const campaign = await createCampaign({
    domain,
    owner_name: String(body.owner_name || "Owner"),
    owner_email: String(body.owner_email || ""),
    ask_price: askPrice,
    floor_price: floorPrice,
    deposit_amount: numberValue(body.deposit_amount, 10),
    can_negotiate: booleanValue(body.can_negotiate),
    can_offer_payment_plan: booleanValue(body.can_offer_payment_plan),
    can_offer_lease_to_own: booleanValue(body.can_offer_lease_to_own),
    use_case_thesis: useCaseThesis,
    tone: String(body.tone || "concise"),
  });

  await saveToSupermemory({
    campaignId: campaign.id,
    type: "campaign_thesis",
    content: JSON.stringify({ campaign, use_case_thesis: useCaseThesis }, null, 2),
  });

  return Response.json({ campaign });
}
