import { pollAgentMailReplies } from "@/lib/agentMailService";

export async function POST() {
  const events = await pollAgentMailReplies();
  return Response.json({ events });
}
