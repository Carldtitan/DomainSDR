import {
  addOrUpdateOutboundMessage,
  getFullCampaign,
  updateLead,
} from "@/lib/campaignStore";
import { generateOutboundEmail } from "@/lib/llmService";
import { saveToSupermemory } from "@/lib/supermemoryService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { leadId?: string; top?: number };
  const full = await getFullCampaign(id);
  if (!full) return Response.json({ error: "Campaign not found" }, { status: 404 });

  const selected = body.leadId
    ? full.leads.filter((lead) => lead.id === body.leadId)
    : full.leads.slice(0, Math.min(body.top || 5, 5));

  const messages = [];
  for (const lead of selected) {
    const generated = await generateOutboundEmail(full.campaign, lead);
    const message = await addOrUpdateOutboundMessage({
      campaign_id: id,
      buyer_lead_id: lead.id,
      subject: generated.subject || full.campaign.domain,
      body: generated.body,
      status: "draft",
    });
    await updateLead(lead.id, { status: "email_drafted", next_action: "Review and send outreach" });
    messages.push(message);
  }

  await saveToSupermemory({
    campaignId: id,
    type: "outreach_messages",
    content: JSON.stringify(messages, null, 2),
  });

  return Response.json({ messages });
}
