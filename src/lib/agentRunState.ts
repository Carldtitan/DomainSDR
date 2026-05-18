import type { ConversationEvent, FullCampaign } from "@/lib/types";

function hasOutboundAfter(events: ConversationEvent[], inbound: ConversationEvent) {
  return events.some(
    (event) =>
      event.buyer_lead_id === inbound.buyer_lead_id &&
      event.direction === "outbound" &&
      event.created_at > inbound.created_at,
  );
}

function activityTime(value: { created_at?: string; sent_at?: string; updated_at?: string }) {
  return value.sent_at || value.created_at || value.updated_at || "";
}

export function buildAgentRunState(full: FullCampaign) {
  const inboundReplies = full.events.filter((event) => event.direction === "inbound" && event.classification !== "system_note");
  const latestInbound = [...inboundReplies].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const pendingInbound = inboundReplies.filter((event) => !hasOutboundAfter(full.events, event));
  const sentMessages = full.messages.filter((message) => message.status === "sent");
  const draftMessages = full.messages.filter((message) => message.status === "draft");
  const failedMessages = full.messages.filter((message) => message.status === "failed");
  const depositPaid = full.offers.some((offer) => offer.status === "deposit_paid");
  const depositRequested = full.offers.some((offer) => offer.status === "deposit_requested" || offer.status === "deposit_paid");

  const terminal = depositPaid || (inboundReplies.length > 0 && pendingInbound.length === 0);
  const stage = depositPaid
    ? "deposit_paid"
    : inboundReplies.length > 0
      ? pendingInbound.length > 0
        ? "reply_received"
        : "reply_handled"
      : sentMessages.length > 0
        ? "waiting_for_reply"
        : draftMessages.length > 0
          ? "starting_outreach"
          : full.leads.length > 0
            ? "preparing_outreach"
            : full.campaign.status === "researching"
              ? "researching"
              : "launching";

  const headlineByStage: Record<string, string> = {
    launching: "The broker is reading the domain and setting a plan.",
    researching: "The broker is searching for likely buyers.",
    preparing_outreach: "The broker found buyers and is choosing who to contact.",
    starting_outreach: "The broker is preparing first-touch outreach.",
    waiting_for_reply: "Outreach is live. The broker is waiting for a buyer to answer.",
    reply_received: "A buyer replied. The broker is handling the response.",
    reply_handled: "A buyer replied and the broker responded inside your rules.",
    deposit_paid: "Deposit received. The buyer has shown purchase intent.",
  };

  const subheadline = depositPaid
    ? "The domain still needs a trusted escrow, marketplace, or registrar transfer path."
    : inboundReplies.length > 0
      ? "The agent can keep negotiating from here, but the demo has reached the proof point: a real buyer response."
      : "Leave this open. The broker will keep waking, expanding the buyer list, sending capped outreach, and checking for replies.";

  const milestones = [
    {
      label: "Understand the domain",
      state: full.campaign.analysis ? "done" : "working",
      detail: full.campaign.analysis?.positioning_statement || full.campaign.use_case_thesis || "Building the sales thesis.",
    },
    {
      label: "Find real buyers",
      state: full.leads.length > 0 ? "done" : full.campaign.status === "researching" ? "working" : "queued",
      detail:
        full.leads.length > 0
          ? `${full.leads.length} buyer${full.leads.length === 1 ? "" : "s"} found and scored.`
          : "Searching the web and enriching contacts.",
    },
    {
      label: "Start outreach",
      state: sentMessages.length > 0 ? "done" : draftMessages.length > 0 ? "working" : "queued",
      detail:
        sentMessages.length > 0
          ? `${sentMessages.length} controlled email${sentMessages.length === 1 ? "" : "s"} sent.`
          : "Writing short, buyer-specific messages and sending only when contactable.",
    },
    {
      label: "Get a response",
      state: inboundReplies.length > 0 ? "done" : sentMessages.length > 0 ? "working" : "queued",
      detail:
        inboundReplies.length > 0
          ? `${inboundReplies.length} inbound repl${inboundReplies.length === 1 ? "y" : "ies"} received.`
          : "Watching AgentMail and scheduled wakes for any buyer reply.",
    },
    {
      label: "Close intent",
      state: depositPaid ? "done" : depositRequested ? "working" : inboundReplies.length > 0 ? "ready" : "queued",
      detail: depositPaid
        ? "Stripe marked the deposit as paid."
        : depositRequested
          ? "Deposit link requested; waiting for checkout."
          : "If a buyer is serious, the broker asks for a deposit and recommends escrow.",
    },
  ];

  const activities = [
    {
      id: `campaign-${full.campaign.id}`,
      at: full.campaign.created_at,
      title: "Broker launched",
      detail: `${full.campaign.domain} listed at seller-defined guardrails.`,
    },
    ...full.leads.slice(0, 8).map((lead) => ({
      id: lead.id,
      at: lead.created_at,
      title: `Buyer found: ${lead.company_name}`,
      detail: `${lead.fit_score}/100 fit. ${lead.reason_fit}`,
    })),
    ...full.messages.slice(0, 8).map((message) => ({
      id: message.id,
      at: activityTime(message),
      title: message.status === "sent" ? "Outreach sent" : message.status === "failed" ? "Outreach failed" : "Outreach drafted",
      detail: `${message.subject}${message.error ? ` - ${message.error}` : ""}`,
    })),
    ...full.events.slice(-10).map((event) => ({
      id: event.id,
      at: event.created_at,
      title:
        event.direction === "inbound"
          ? `Buyer replied: ${event.classification.replaceAll("_", " ")}`
          : event.classification === "system_note"
            ? "Broker note"
            : "Broker responded",
      detail: event.body,
    })),
    ...full.offers.map((offer) => ({
      id: offer.id,
      at: offer.updated_at,
      title: offer.status === "deposit_paid" ? "Deposit paid" : "Deposit link created",
      detail: `$${offer.amount} ${offer.status.replaceAll("_", " ")}`,
    })),
  ]
    .filter((item) => item.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);

  return {
    campaignId: full.campaign.id,
    domain: full.campaign.domain,
    stage,
    terminal,
    needsAgentResponse: pendingInbound.length > 0,
    headline: headlineByStage[stage],
    subheadline,
    latestReply: latestInbound
      ? {
          body: latestInbound.body,
          classification: latestInbound.classification,
          offerAmount: latestInbound.offer_amount,
          createdAt: latestInbound.created_at,
        }
      : null,
    counts: {
      buyersFound: full.leads.length,
      drafted: draftMessages.length,
      sent: sentMessages.length,
      failed: failedMessages.length,
      replies: inboundReplies.length,
      depositsRequested: full.offers.filter((offer) => offer.status === "deposit_requested" || offer.status === "deposit_paid").length,
      depositsPaid: full.offers.filter((offer) => offer.status === "deposit_paid").length,
    },
    milestones,
    activities,
  };
}
