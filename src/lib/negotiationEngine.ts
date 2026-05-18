import type {
  BuyerLead,
  ConversationEvent,
  DomainCampaign,
  NegotiationPolicy,
  ReplyClassification,
} from "@/lib/types";
import { money } from "@/lib/format";

export type NegotiationDraft = {
  body: string;
  next_action: string;
  should_suppress?: boolean;
  should_request_deposit?: boolean;
  should_escalate?: boolean;
  accepted_amount?: number;
};

function signature(campaign: DomainCampaign) {
  return campaign.owner_name || "Domain owner";
}

function counterAboveFloor(policy: NegotiationPolicy) {
  const raw = Math.max(policy.floor_price * 1.2, policy.floor_price + 100);
  return Math.min(policy.ask_price, Math.ceil(raw / 50) * 50);
}

export function generateNegotiationReply(
  campaign: DomainCampaign,
  buyer: BuyerLead,
  classification: ReplyClassification | ConversationEvent,
  policy: NegotiationPolicy,
): NegotiationDraft {
  const replyClass = "classification" in classification ? classification.classification : "other";
  const amount = "offer_amount" in classification ? classification.offer_amount : undefined;
  const replyBody = "body" in classification ? classification.body : "";
  const company = buyer.company_name;

  if (replyClass === "opt_out") {
    return {
      body: `Understood. I will not follow up again.

${signature(campaign)}`,
      next_action: "Suppressed future contact.",
      should_suppress: true,
    };
  }

  if (replyClass === "not_interested") {
    return {
      body: `Thanks for the quick reply. I will close the loop here.

${signature(campaign)}`,
      next_action: "No follow-up unless buyer re-engages.",
      should_suppress: true,
    };
  }

  if (replyClass === "asks_proof") {
    return {
      body: `Yes. I can verify ownership by adding a TXT record, pointing the domain to a simple verification page, or routing the transaction through a trusted escrow/marketplace.

Which verification route would be easiest on your side?

${signature(campaign)}`,
      next_action: "Offer ownership verification without making legal claims.",
    };
  }

  if (replyClass === "asks_escrow") {
    return {
      body: `Yes, I prefer using a trusted escrow or marketplace for the actual domain transfer as well. The deposit is only to confirm intent while we set up the safe transfer path.

${signature(campaign)}`,
      next_action: "Proceed through escrow or trusted marketplace.",
    };
  }

  if (replyClass === "legal_concern") {
    return {
      body: `I cannot guarantee trademark or legal clearance. If you are interested in the name, the right next step is to have counsel review it and use a trusted escrow or marketplace for transfer.

${signature(campaign)}`,
      next_action: "Recommend legal review and avoid legal assurances.",
      should_escalate: true,
    };
  }

  if (replyClass === "asks_payment_plan") {
    if (/\b(no|not|without|don't want|do not want)\b.{0,40}\b(payment plan|installments?|monthly|lease)\b/i.test(replyBody)) {
      return {
        body: `No problem. We can keep this as a direct sale for ${campaign.domain}. The ask is ${money(policy.ask_price)}, and transfer should run through escrow or a trusted marketplace.

If ${company} wants to proceed, I can send a ${money(policy.deposit_amount)} deposit link to confirm intent.

${signature(campaign)}`,
        next_action: "Buyer prefers direct sale; await confirmation to send deposit link.",
      };
    }

    if (!policy.allow_payment_plan) {
      return {
        body: `I am keeping this simple as a direct sale for now. The ask is ${money(policy.ask_price)}, with transfer handled through escrow or a trusted marketplace.

${signature(campaign)}`,
        next_action: "Payment plan declined by seller policy.",
      };
    }

    return {
      body: `A short payment plan could work if there is a ${money(policy.deposit_amount)} deposit and the domain stays secured through an escrow or marketplace process until paid.

What structure did you have in mind?

${signature(campaign)}`,
      next_action: "Discuss payment plan within seller-approved terms.",
    };
  }

  if (replyClass === "asks_price" || (!amount && replyClass === "interested")) {
    const buyerWantsNextStep = /\b(buy|purchase|move forward|go ahead|proceed|send (the )?(link|invoice)|checkout|invoice|pay|deposit|let'?s do it|sounds good|works for me|yes please)\b/i.test(replyBody);
    if (buyerWantsNextStep) {
      return {
        body: `Thanks. The ask for ${campaign.domain} is ${money(policy.ask_price)}.

If ${company} wants to move forward, I can send a ${money(policy.deposit_amount)} deposit link to confirm intent while we use escrow or a trusted marketplace for transfer.

${signature(campaign)}`,
        next_action: "Buyer asked how to buy; send ask price and deposit link.",
        should_request_deposit: true,
        accepted_amount: policy.ask_price,
        should_escalate: policy.ask_price >= policy.escalation_threshold,
      };
    }

    return {
      body: `Thanks. The ask for ${campaign.domain} is ${money(policy.ask_price)}.

If ${company} wants to move forward, I can send a ${money(policy.deposit_amount)} deposit link to confirm intent while we use escrow or a trusted marketplace for transfer.

${signature(campaign)}`,
      next_action: "Await buyer response to ask price.",
    };
  }

  if (typeof amount === "number") {
    if (amount >= policy.ask_price) {
      return {
        body: `${money(amount)} works. I can send a ${money(policy.deposit_amount)} deposit link to confirm intent, then we can complete the transfer through escrow or a trusted marketplace.

${signature(campaign)}`,
        next_action: "Accept offer and request deposit.",
        should_request_deposit: true,
        accepted_amount: amount,
        should_escalate: amount >= policy.escalation_threshold,
      };
    }

    if (amount >= policy.floor_price) {
      const buyerAskedForLink = /send link|send the link|link|pay|deposit/i.test(replyBody);
      if (campaign.can_negotiate && buyerAskedForLink) {
        return {
          body: `${money(amount)} works for me as an intent deposit step. I can send a ${money(policy.deposit_amount)} deposit link, and the actual transfer should run through escrow or a trusted marketplace.

${signature(campaign)}`,
          next_action: "Accept within floor and request deposit.",
          should_request_deposit: true,
          accepted_amount: amount,
          should_escalate: amount >= policy.escalation_threshold,
        };
      }

      const counter = Math.max(amount + 100, Math.round(policy.ask_price * 0.8));
      const safeCounter = Math.min(policy.ask_price, Math.max(policy.floor_price, Math.ceil(counter / 50) * 50));
      return {
        body: `I could not do ${money(amount)}, but I can meet you at ${money(safeCounter)} for ${campaign.domain}.

If that works, I can send a ${money(policy.deposit_amount)} deposit link and use escrow or a trusted marketplace for transfer.

${signature(campaign)}`,
        next_action: amount >= policy.escalation_threshold ? "Human approval recommended before accepting." : "Countered above floor.",
        should_escalate: amount >= policy.escalation_threshold,
      };
    }

    const counter = counterAboveFloor(policy);
    return {
      body: `I appreciate the offer, but I could not do ${money(amount)}.

The lowest counter I can put forward here is ${money(counter)}. If that is workable, I can send a small deposit link and use escrow or a trusted marketplace for transfer.

${signature(campaign)}`,
      next_action: "Rejected below-floor offer and countered above floor.",
    };
  }

  return {
    body: `Thanks for the note. The clean next step is pricing: the ask for ${campaign.domain} is ${money(policy.ask_price)}, and any real transfer should go through escrow or a trusted marketplace.

${signature(campaign)}`,
    next_action: "Sent default pricing response.",
  };
}
