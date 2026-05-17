import type { BuyerLead } from "@/lib/types";

function normalizeMention(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function reconcileLeadFromReplyBody(body: string, currentLead: BuyerLead, leads: BuyerLead[]) {
  const text = normalizeMention(body);
  if (!text) return currentLead;

  const matches = leads
    .filter((lead) => lead.campaign_id === currentLead.campaign_id)
    .map((lead) => ({ lead, name: normalizeMention(lead.company_name) }))
    .filter(({ name }) => name.length >= 4 && text.includes(name))
    .sort((a, b) => b.name.length - a.name.length);

  return matches[0]?.lead || currentLead;
}
