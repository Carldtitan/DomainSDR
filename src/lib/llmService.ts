import type { BuyerLead, DomainAnalysis, DomainCampaign, OutboundMessage, ReplyClassification } from "@/lib/types";
import { domainLabel, money, splitDomainWords, titleCase, truncate } from "@/lib/format";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiPart = { text?: string };
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  error?: { message?: string };
};

function fallbackAnalysis(domain: string, thesis?: string): DomainAnalysis {
  const label = titleCase(domainLabel(domain));
  const words = splitDomainWords(domain);
  if (words.some((word) => ["car", "cars", "auto", "autos", "vehicle", "vehicles"].includes(word))) {
    return {
      likely_use_cases: [
        thesis?.trim() || "automotive AI marketplace or assistant",
        "AI dealership sales and BDC agents",
        "AI vehicle inspection and pricing tools",
        "automotive retail intelligence",
      ],
      buyer_categories: [
        "AI car dealership software companies",
        "Automotive AI startups",
        "Vehicle inspection AI companies",
        "Used car marketplace platforms",
        "Automotive retail intelligence platforms",
      ],
      positioning_statement: `${domain} is a direct category domain for automotive AI products, marketplaces, and dealership automation.`,
      risks: [
        "Do not imply traffic, revenue, or legal clearance.",
        "Confirm trademark posture with counsel before any real transfer.",
        "Use a trusted escrow or marketplace for the domain transfer.",
      ],
      suggested_search_queries: [
        "AI car dealership software startup",
        "automotive AI startup",
        "AI vehicle inspection startup",
        "AI used car marketplace startup",
        "AI BDC car dealers software",
      ],
      outbound_recommended: true,
    };
  }
  const useCase = thesis?.trim() || `${label} branded software, AI, and service workflows`;
  return {
    likely_use_cases: [
      useCase,
      `${label} category landing page`,
      `${label} product line or rebrand`,
    ],
    buyer_categories: [
      "AI software companies",
      "B2B service platforms",
      "Customer support and operations tools",
      "Startups with weaker current domains",
    ],
    positioning_statement: `${domain} is shortest to position around ${useCase.toLowerCase()}.`,
    risks: [
      "Do not imply traffic, revenue, or legal clearance.",
      "Confirm trademark posture with counsel before any real transfer.",
      "Use a trusted escrow or marketplace for the domain transfer.",
    ],
    suggested_search_queries: [
      `"${useCase}" startup`,
      `${label} AI software company`,
      `${label} customer support platform`,
      `${label} receptionist software`,
    ],
    outbound_recommended: true,
  };
}

function extractJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

async function generateJson<T>(prompt: string, fallback: T, temperature = 0.25): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallback;

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        responseMimeType: "application/json",
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok) return fallback;

  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  return extractJson<T>(text, fallback);
}

export async function analyzeDomain(domain: string, useCaseThesis?: string): Promise<DomainAnalysis> {
  const fallback = fallbackAnalysis(domain, useCaseThesis);
  return generateJson<DomainAnalysis>(
    `Analyze the domain ${domain} for a careful low-volume outbound domain sale campaign.

Optional seller thesis: ${useCaseThesis || "none"}

Return JSON only with:
{
  "likely_use_cases": string[],
  "buyer_categories": string[],
  "positioning_statement": string,
  "risks": string[],
  "suggested_search_queries": string[],
  "outbound_recommended": boolean
}

Constraints:
- No fake urgency.
- No claims about traffic, revenue, existing buyers, or legal safety.
- Suggested queries should find companies that would specifically value this domain.`,
    fallback,
  );
}

export type ScoreResult = {
  score: number;
  explanation: string;
  recommended_outreach_angle: string;
};

function fallbackScore(domain: string, campaign: DomainCampaign, buyer: Partial<BuyerLead>): ScoreResult {
  const words = splitDomainWords(domain);
  const haystack = `${buyer.company_name ?? ""} ${buyer.website ?? ""} ${buyer.reason_fit ?? ""}`.toLowerCase();
  const overlap = words.filter((word) => haystack.includes(word)).length;
  const weakDomain =
    buyer.current_domain?.includes("-") ||
    (buyer.current_domain && buyer.current_domain.length > domain.length + 8) ||
    (!buyer.current_domain?.endsWith(".ai") && domain.endsWith(".ai"));
  const base = 62 + overlap * 8 + (weakDomain ? 10 : 0);
  const score = Math.max(45, Math.min(94, base));

  return {
    score,
    explanation: `${buyer.company_name ?? "This company"} appears relevant to ${campaign.use_case_thesis || domain}; the current web presence gives ${domain} a cleaner category fit.`,
    recommended_outreach_angle:
      buyer.reason_fit ||
      `Map ${domain} to ${campaign.use_case_thesis || "their product category"} without making performance or legal claims.`,
  };
}

export async function scoreBuyer(domain: string, campaign: DomainCampaign, buyer: Partial<BuyerLead>): Promise<ScoreResult> {
  const fallback = fallbackScore(domain, campaign, buyer);
  return generateJson<ScoreResult>(
    `Score this buyer for a domain outbound sale.

Domain: ${domain}
Seller thesis: ${campaign.use_case_thesis || "none"}
Ask price: ${money(campaign.ask_price)}

Buyer:
${JSON.stringify(buyer, null, 2)}

Return JSON only:
{
  "score": number,
  "explanation": string,
  "recommended_outreach_angle": string
}

Score 0-100 using category match, current domain weakness, commercial relevance, likely ability to pay, timing/rebrand signal if known, and contactability.
This is buyer fit priority, not transaction certainty. Do not push a strongly relevant buyer below 60 solely because the ask price is high.
Do not invent facts. If a signal is unknown, say so briefly.`,
    fallback,
    0.15,
  );
}

export type GeneratedEmail = {
  subject: string;
  body: string;
};

export async function generateOutboundEmail(campaign: DomainCampaign, buyer: BuyerLead): Promise<GeneratedEmail> {
  const firstName = buyer.decision_maker_name?.split(" ")[0] || "there";
  const fallback = {
    subject: campaign.domain,
    body: `Hi ${firstName},

Saw that ${buyer.company_name} is focused on ${buyer.buyer_category.toLowerCase()}. I own ${campaign.domain} and thought it mapped cleanly to ${campaign.use_case_thesis || buyer.outreach_angle || "that category"}.

Worth sending over pricing, or should I close the loop here?

${campaign.owner_name}

If this is not relevant, reply no and I will not follow up.`,
  };

  return generateJson<GeneratedEmail>(
    `Write a careful outbound email for a domain owner.

Campaign:
${JSON.stringify(campaign, null, 2)}

Buyer:
${JSON.stringify(buyer, null, 2)}

Return JSON only:
{
  "subject": string,
  "body": string
}

Rules:
- Subject should usually be exactly the domain name.
- Body must be under 80 words.
- Be specific to the buyer.
- No fake urgency.
- No hype like "premium domain".
- No false claims.
- Do not claim traffic, revenue, existing buyers, or legal/trademark safety.
- Include a simple opt-out line.
- Sign with the owner name.`,
    fallback,
    0.3,
  );
}

export async function generateFollowUpEmail(
  campaign: DomainCampaign,
  buyer: BuyerLead,
  previousMessage: OutboundMessage,
): Promise<GeneratedEmail> {
  const angle = truncate(buyer.outreach_angle || buyer.reason_fit, 80);
  const fallback = {
    subject: previousMessage.subject.toLowerCase().startsWith("re:")
      ? previousMessage.subject
      : `Re: ${previousMessage.subject}`,
    body: `Hi,

Quick follow-up on ${campaign.domain}. I thought it could be relevant to ${buyer.company_name} given ${angle}.

Worth a quick look, or should I close the loop?

${campaign.owner_name}

Reply no and I will not follow up again.`,
  };

  return generateJson<GeneratedEmail>(
    `Write one careful follow-up email for a domain outbound thread.

Campaign:
${JSON.stringify(campaign, null, 2)}

Buyer:
${JSON.stringify(buyer, null, 2)}

Previous outbound:
Subject: ${previousMessage.subject}
Body:
${previousMessage.body}

Return JSON only:
{
  "subject": string,
  "body": string
}

Rules:
- This is the only follow-up.
- Body under 70 words.
- Be specific but low-pressure.
- No fake urgency.
- No hype like "premium domain".
- Do not claim traffic, revenue, existing buyers, legal safety, or trademark safety.
- Include a simple opt-out line.
- Sign with owner name.`,
    fallback,
    0.25,
  );
}

function extractOfferAmount(text: string) {
  const compact = text.replace(/,/g, "");
  const dollar = compact.match(/\$\s*(\d{2,7})/);
  if (dollar?.[1]) return Number(dollar[1]);
  const bare = compact.match(/\b(\d{3,7})\b/);
  return bare?.[1] ? Number(bare[1]) : undefined;
}

export function classifyReplyFallback(text: string): ReplyClassification {
  const lower = text.toLowerCase();
  const amount = extractOfferAmount(text);

  if (/unsubscribe|opt out|remove me|do not email|don't email|stop contacting/.test(lower)) {
    return {
      classification: "opt_out",
      offer_amount: amount,
      urgency: "low",
      next_action: "Suppress future contact and send one confirmation at most.",
      explanation: "The buyer asked not to be contacted.",
    };
  }
  if (/not interested|no thanks|pass\b|not a fit/.test(lower)) {
    return {
      classification: "not_interested",
      offer_amount: amount,
      urgency: "low",
      next_action: "Do not follow up unless they ask a new question.",
      explanation: "The buyer declined.",
    };
  }
  if (/prove|proof|own|ownership|verify|txt record/.test(lower)) {
    return {
      classification: "asks_proof",
      offer_amount: amount,
      urgency: "medium",
      next_action: "Offer TXT record, landing page, or escrow/marketplace verification.",
      explanation: "The buyer wants ownership verification.",
    };
  }
  if (/payment plan|installment|monthly|lease/.test(lower)) {
    return {
      classification: "asks_payment_plan",
      offer_amount: amount,
      urgency: "medium",
      next_action: "Check whether seller allows payment plans.",
      explanation: "The buyer asked about terms.",
    };
  }
  if (/escrow|dan\.com|afternic|sedo|marketplace|escrow.com/.test(lower)) {
    return {
      classification: "asks_escrow",
      offer_amount: amount,
      urgency: "medium",
      next_action: "Confirm a trusted escrow or marketplace route.",
      explanation: "The buyer asked about transaction safety.",
    };
  }
  if (/trademark|legal|lawsuit|brand conflict|clearance/.test(lower)) {
    return {
      classification: "legal_concern",
      offer_amount: amount,
      urgency: "high",
      next_action: "Do not give legal assurances; recommend counsel.",
      explanation: "The buyer raised legal risk.",
    };
  }
  if (amount) {
    return {
      classification: /would you take|offer|can do|i can do|pay/.test(lower) ? "lowball_offer" : "interested",
      offer_amount: amount,
      urgency: "high",
      next_action: "Evaluate the offer against the seller floor and escalation threshold.",
      explanation: "The buyer included a dollar amount.",
    };
  }
  if (/how much|price|pricing|cost|ask|asking/.test(lower)) {
    return {
      classification: "asks_price",
      urgency: "medium",
      next_action: "Share ask price without revealing floor.",
      explanation: "The buyer asked for pricing.",
    };
  }
  if (/interested|tell me more|send|worth|okay|ok|yes/.test(lower)) {
    return {
      classification: "interested",
      urgency: "medium",
      next_action: "Send concise pricing or next step.",
      explanation: "The buyer expressed interest.",
    };
  }

  return {
    classification: "other",
    offer_amount: amount,
    urgency: "low",
    next_action: "Review manually or ask one clarifying question.",
    explanation: "No clear sales intent detected.",
  };
}

export async function classifyReply(reply: string): Promise<ReplyClassification> {
  const fallback = classifyReplyFallback(reply);
  return generateJson<ReplyClassification>(
    `Classify this buyer reply for a domain sale negotiation.

Reply:
${reply}

Allowed classes:
asks_price, interested, lowball_offer, not_interested, opt_out, asks_proof, asks_payment_plan, asks_escrow, legal_concern, confused, other

Return JSON only:
{
  "classification": one allowed class,
  "offer_amount": number or omitted,
  "urgency": "low" | "medium" | "high",
  "next_action": string,
  "explanation": string
}

Extract only explicit offer amounts. Do not infer a price if none is present.`,
    fallback,
    0.1,
  );
}
