import { getFullCampaign } from "@/lib/campaignStore";
import { startAgentPhoneCall } from "@/lib/agentPhoneService";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    campaignId?: string;
    leadId?: string;
    toNumber?: string;
  };

  if (!body.campaignId || !body.leadId) {
    return Response.json({ error: "campaignId and leadId are required" }, { status: 400 });
  }

  const full = await getFullCampaign(body.campaignId);
  const lead = full?.leads.find((item) => item.id === body.leadId);
  if (!full || !lead || !full.policy) {
    return Response.json({ error: "Campaign, lead, or policy not found" }, { status: 404 });
  }

  const result = await startAgentPhoneCall({
    campaign: full.campaign,
    lead,
    policy: full.policy,
    toNumber: body.toNumber,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
}
