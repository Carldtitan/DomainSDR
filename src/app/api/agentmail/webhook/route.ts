import { Webhook } from "svix";
import { processAgentMailMessage, type AgentMailMessage } from "@/lib/agentMailService";
import { runAgentTick } from "@/lib/agentOrchestrator";

type AgentMailWebhookPayload = {
  event_type?: string;
  event_id?: string;
  message?: AgentMailMessage;
};

function svixHeaders(request: Request) {
  return {
    "svix-id": request.headers.get("svix-id") || "",
    "svix-timestamp": request.headers.get("svix-timestamp") || "",
    "svix-signature": request.headers.get("svix-signature") || "",
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;

  let payload: AgentMailWebhookPayload;
  try {
    payload = secret
      ? (new Webhook(secret).verify(rawBody, svixHeaders(request)) as AgentMailWebhookPayload)
      : (JSON.parse(rawBody || "{}") as AgentMailWebhookPayload);
  } catch {
    return Response.json({ error: "Invalid AgentMail webhook signature" }, { status: 400 });
  }

  if (payload.event_type !== "message.received" || !payload.message?.message_id) {
    return Response.json({ ok: true, ignored: true, event_type: payload.event_type });
  }

  const event = await processAgentMailMessage(payload.message);
  const agent = await runAgentTick({
    campaignId: event?.campaign_id,
    discoverBuyers: true,
    sendFirstTouch: true,
    sendNegotiationReplies: true,
    sendFollowUps: true,
    minLeadsPerCampaign: 25,
    minReachablePerCampaign: 5,
    maxLeadPoolPerCampaign: 40,
    maxDraftsPerTick: 8,
    maxContactEnrichmentPerTick: 4,
    maxFirstTouchSendsPerTick: 4,
    maxFollowUpsPerTick: 3,
    maxDailySends: 15,
  });

  return Response.json({ ok: true, event, agent });
}
