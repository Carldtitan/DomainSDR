import { updateOutboundMessage } from "@/lib/campaignStore";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as { subject?: string; body?: string };
  const message = await updateOutboundMessage(id, {
    subject: body.subject,
    body: body.body,
  });

  if (!message) return Response.json({ error: "Message not found" }, { status: 404 });
  return Response.json({ message });
}
