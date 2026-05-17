import {
  addConversationEvent,
  addSuppression,
  loadStore,
  updateLead,
} from "@/lib/campaignStore";
import { classifyReply } from "@/lib/llmService";
import { generateNegotiationReply } from "@/lib/negotiationEngine";
import { createDepositLink } from "@/lib/paymentService";
import { searchSupermemoryContext, saveToSupermemory } from "@/lib/supermemoryService";
import type { BuyerLead, DomainCampaign, EventChannel } from "@/lib/types";

type InboundAgentInput = {
  body: string;
  channel: EventChannel;
  campaignId?: string;
  leadId?: string;
  externalMessageId?: string;
  externalConversationId?: string;
  externalCallId?: string;
  shouldCreateDepositLink?: boolean;
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9.]+/g, " ").replace(/\s+/g, " ").trim();
}

function pickCampaignAndLead(input: InboundAgentInput, campaigns: DomainCampaign[], leads: BuyerLead[]) {
  const text = normalize(input.body);
  const campaign =
    campaigns.find((item) => item.id === input.campaignId) ||
    campaigns.find((item) => text.includes(item.domain.toLowerCase())) ||
    [...campaigns]
      .filter((item) => !["closed", "paused"].includes(item.status))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  if (!campaign) return {};

  const campaignLeads = leads.filter((lead) => lead.campaign_id === campaign.id);
  const lead =
    campaignLeads.find((item) => item.id === input.leadId) ||
    campaignLeads
      .map((item) => ({
        lead: item,
        score:
          (text.includes(normalize(item.company_name)) ? normalize(item.company_name).length : 0) +
          (item.website && text.includes(normalize(item.website)) ? 8 : 0),
      }))
      .sort((a, b) => b.score - a.score)[0]?.lead ||
    [...campaignLeads].sort((a, b) => {
      const statusWeight = (lead: BuyerLead) =>
        lead.status === "deposit_requested" ? 5 : lead.status === "negotiating" ? 4 : lead.status === "replied" ? 3 : lead.status === "sent" ? 2 : 1;
      return statusWeight(b) - statusWeight(a) || b.updated_at.localeCompare(a.updated_at);
    })[0];

  return { campaign, lead };
}

function voiceClean(body: string) {
  return body
    .replace(/\n{3,}/g, "\n\n")
    .replace(/https?:\/\/\S+/g, "I can send that link by text or email.")
    .slice(0, 900);
}

export async function processInboundAgentMessage(input: InboundAgentInput) {
  const store = await loadStore();
  const { campaign, lead } = pickCampaignAndLead(input, store.campaigns, store.buyerLeads);
  if (!campaign || !lead) {
    return {
      ok: false,
      responseText: "I can help with the domain, but I need the domain name or company name to pull up the right campaign.",
      error: "No campaign or lead could be matched.",
    };
  }

  const policy = store.negotiationPolicies.find((item) => item.campaign_id === campaign.id);
  if (!policy) {
    return { ok: false, responseText: "I found the campaign, but no negotiation policy is configured.", error: "No policy" };
  }

  const memory = await searchSupermemoryContext({
    campaignId: campaign.id,
    query: `${campaign.domain} ${lead.company_name} ${input.body}`,
    limit: 4,
  });
  const classification = await classifyReply(input.body);
  const draft = generateNegotiationReply(
    campaign,
    lead,
    { ...classification, body: `${input.body}\n\nRelevant memory:\n${memory.join("\n---\n")}` },
    policy,
  );

  const inbound = await addConversationEvent({
    campaign_id: campaign.id,
    buyer_lead_id: lead.id,
    channel: input.channel,
    direction: "inbound",
    body: input.body,
    classification: classification.classification,
    offer_amount: classification.offer_amount,
    urgency: classification.urgency,
    next_action: draft.next_action,
    suggested_response: draft.body,
    external_message_id: input.externalMessageId,
    external_conversation_id: input.externalConversationId,
    external_call_id: input.externalCallId,
  });

  let responseBody = draft.body;
  let offer;
  if (draft.should_request_deposit && input.shouldCreateDepositLink !== false) {
    offer = await createDepositLink(campaign, lead, draft.accepted_amount || classification.offer_amount || policy.ask_price);
    responseBody = `${draft.body}

Deposit link: ${offer.payment_link}

The deposit only confirms intent. The domain transfer should still go through escrow or a trusted marketplace.`;
  }

  const outbound = await addConversationEvent({
    campaign_id: campaign.id,
    buyer_lead_id: lead.id,
    channel: input.channel,
    direction: "outbound",
    body: responseBody,
    classification: "sent_email",
    offer_amount: draft.accepted_amount || classification.offer_amount,
    next_action: draft.should_request_deposit ? "Deposit requested; await deposit." : "Await buyer response.",
    external_conversation_id: input.externalConversationId,
    external_call_id: input.externalCallId,
  });

  if (draft.should_suppress) {
    await addSuppression({
      campaign_id: campaign.id,
      buyer_lead_id: lead.id,
      email: lead.contact_email,
      reason: classification.classification,
    });
    await updateLead(lead.id, { status: "opted_out", next_action: "Suppressed" });
  } else {
    await updateLead(lead.id, {
      status: draft.should_request_deposit ? "deposit_requested" : "negotiating",
      next_action: draft.should_request_deposit ? "Await deposit" : draft.next_action,
    });
  }

  await saveToSupermemory({
    campaignId: campaign.id,
    type: `${input.channel}_agent_turn`,
    content: JSON.stringify({ lead, inbound, outbound, classification, offer }, null, 2),
  });

  return {
    ok: true,
    campaign,
    lead,
    inbound,
    outbound,
    offer,
    responseText: input.channel === "phone" ? voiceClean(responseBody) : responseBody,
  };
}
