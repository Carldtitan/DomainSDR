import { getLead, updateLead } from "@/lib/campaignStore";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const lead = await getLead(id);
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
  const updated = await updateLead(id, { status: "escalated", next_action: "Owner approval recommended" });
  return Response.json({ lead: updated });
}
