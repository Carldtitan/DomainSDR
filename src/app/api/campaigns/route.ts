import { createCampaign } from "@/lib/campaignStore";
import { runAgentTick } from "@/lib/agentOrchestrator";
import { analyzeDomain } from "@/lib/llmService";
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
  const analysis = await analyzeDomain(domain, useCaseThesis);
  const campaign = await createCampaign(
    {
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
    },
    analysis,
  );

  await saveToSupermemory({
    campaignId: campaign.id,
    type: "campaign_thesis",
    content: JSON.stringify({ campaign, analysis }, null, 2),
  });

  let broker = null;
  let brokerError = "";
  try {
    broker = await runAgentTick({
      campaignId: campaign.id,
      forceResearch: true,
      discoverBuyers: true,
      sendFirstTouch: true,
      sendNegotiationReplies: true,
      sendFollowUps: true,
      makePhoneCalls: false,
      minLeadsPerCampaign: 5,
      minHoursBetweenResearch: 0,
      maxDraftsPerTick: 5,
      maxFirstTouchSendsPerTick: 2,
      maxFollowUpsPerTick: 1,
    });
  } catch (error) {
    brokerError = error instanceof Error ? error.message : "Broker launch failed";
    console.error("Broker launch failed", error);
  }

  return Response.json({ campaign, broker, brokerError });
}
