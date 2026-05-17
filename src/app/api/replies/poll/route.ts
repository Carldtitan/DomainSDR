import { runAgentTick } from "@/lib/agentOrchestrator";

export async function POST() {
  const result = await runAgentTick({
    sendNegotiationReplies: true,
    sendFollowUps: false,
  });
  return Response.json(result);
}
