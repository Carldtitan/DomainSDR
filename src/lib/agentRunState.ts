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
  const reachableLeads = full.leads.filter((lead) => lead.contact_email || lead.contact_phone);
  const emailReachable = full.leads.filter((lead) => lead.contact_email);
  const phoneReachable = full.leads.filter((lead) => lead.contact_phone);
  const callsStarted = full.events.filter(
    (event) => event.channel === "phone" && event.direction === "outbound" && event.classification === "system_note",
  );
  const depositPaid = full.offers.some((offer) => offer.status === "deposit_paid");
  const depositRequested = full.offers.some((offer) => offer.status === "deposit_requested" || offer.status === "deposit_paid");
  const ended = full.campaign.status === "closed";
  const paused = full.campaign.status === "paused";

  const terminal = ended || paused || depositPaid || (inboundReplies.length > 0 && pendingInbound.length === 0);
  const stage = ended
    ? "ended"
    : paused
      ? "paused"
      : depositPaid
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
    launching: "Planning",
    researching: "Finding buyers",
    preparing_outreach: "Selecting contacts",
    starting_outreach: "Preparing outreach",
    waiting_for_reply: "Waiting for replies",
    reply_received: "Reply received",
    reply_handled: "Reply handled",
    deposit_paid: "Deposit paid",
    ended: "Ended",
    paused: "Paused",
  };

  const subheadline = ended
    ? "This run is stopped."
    : paused
      ? "This run is paused."
      : depositPaid
    ? "Use escrow or a trusted marketplace for transfer."
    : inboundReplies.length > 0
      ? "The run reached a buyer response."
      : "Keep this page open for live status.";

  const milestones = [
    {
      label: "Plan",
      state: full.campaign.analysis ? "done" : "working",
      detail: full.campaign.use_case_thesis || "Plan ready.",
    },
    {
      label: "Buyers",
      state: full.leads.length > 0 ? "done" : full.campaign.status === "researching" ? "working" : "queued",
      detail:
        full.leads.length > 0
          ? `${full.leads.length} found. ${reachableLeads.length} reachable.`
          : "Finding companies and contacts.",
    },
    {
      label: "Outreach",
      state: sentMessages.length > 0 || callsStarted.length > 0 ? "done" : draftMessages.length > 0 || reachableLeads.length > 0 ? "working" : "queued",
      detail:
        sentMessages.length > 0 || callsStarted.length > 0
          ? `${sentMessages.length} emails. ${callsStarted.length} calls.`
          : "Preparing messages.",
    },
    {
      label: "Replies",
      state: inboundReplies.length > 0 ? "done" : sentMessages.length > 0 ? "working" : "queued",
      detail:
        inboundReplies.length > 0
          ? `${inboundReplies.length} received.`
          : "Waiting.",
    },
    {
      label: "Deposit",
      state: depositPaid ? "done" : depositRequested ? "working" : inboundReplies.length > 0 ? "ready" : "queued",
      detail: depositPaid
        ? "Paid."
        : depositRequested
          ? "Link sent."
          : "Not requested.",
    },
  ];

  const activities = [
    {
      id: `campaign-${full.campaign.id}`,
      at: full.campaign.created_at,
      title: "Started",
      detail: `${full.campaign.domain}`,
    },
    ...[...full.leads].sort((a, b) => b.fit_score - a.fit_score).slice(0, 8).map((lead) => ({
      id: lead.id,
      at: lead.created_at,
      title: lead.company_name,
      detail: `${lead.fit_score}/100. ${lead.reason_fit}`,
    })),
    ...full.messages.slice(0, 8).map((message) => ({
      id: message.id,
      at: activityTime(message),
      title: message.status === "sent" ? "Email sent" : message.status === "failed" ? "Email failed" : "Draft ready",
      detail: `${message.subject}${message.error ? ` - ${message.error}` : ""}`,
    })),
    ...full.events.slice(-10).map((event) => ({
      id: event.id,
      at: event.created_at,
      title:
        event.direction === "inbound"
          ? `Reply: ${event.classification.replaceAll("_", " ")}`
          : event.classification === "system_note"
            ? "Note"
            : "Response sent",
      detail: event.body,
    })),
    ...full.offers.map((offer) => ({
      id: offer.id,
      at: offer.updated_at,
      title: offer.status === "deposit_paid" ? "Deposit paid" : "Deposit link",
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
      reachable: reachableLeads.length,
      emailReachable: emailReachable.length,
      phoneReachable: phoneReachable.length,
      drafted: draftMessages.length,
      sent: sentMessages.length,
      callsStarted: callsStarted.length,
      failed: failedMessages.length,
      replies: inboundReplies.length,
      depositsRequested: full.offers.filter((offer) => offer.status === "deposit_requested" || offer.status === "deposit_paid").length,
      depositsPaid: full.offers.filter((offer) => offer.status === "deposit_paid").length,
    },
    milestones,
    activities,
  };
}
