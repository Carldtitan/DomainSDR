import { runAgentTick } from "@/lib/agentOrchestrator";

export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    campaignId?: string;
    discoverBuyers?: boolean;
    sendFirstTouch?: boolean;
    sendNegotiationReplies?: boolean;
    sendFollowUps?: boolean;
    makePhoneCalls?: boolean;
    minHoursSinceLastSend?: number;
    minHoursBetweenResearch?: number;
    minLeadsPerCampaign?: number;
    maxNegotiationRepliesPerTick?: number;
    maxDraftsPerTick?: number;
    maxFirstTouchSendsPerTick?: number;
    maxFollowUpsPerTick?: number;
    maxCallsPerTick?: number;
    maxDailyNegotiationSends?: number;
    maxDailySends?: number;
  };
  const result = await runAgentTick(body);
  return Response.json(result);
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await runAgentTick();
  return Response.json(result);
}
