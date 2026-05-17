import { handleAgentPhoneWebhook } from "@/lib/agentPhoneService";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const result = await handleAgentPhoneWebhook(
    rawBody,
    request.headers.get("agentphone-signature") || request.headers.get("x-agentphone-signature"),
  );

  return Response.json(result.body, { status: result.status });
}
