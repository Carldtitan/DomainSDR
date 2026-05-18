import type { BuyerLead, DomainAnalysis, DomainCampaign } from "@/lib/types";
import { apifyAllowed, apifyRunSyncDatasetUrl } from "@/lib/apifyClient";
import { enrichLeadContacts } from "@/lib/contactEnrichment";
import { domainFromUrl, normalizeDomain, splitDomainWords, titleCase } from "@/lib/format";
import { scoreBuyer } from "@/lib/llmService";

type SearchResult = {
  title?: string;
  url?: string;
  link?: string;
  description?: string;
  snippet?: string;
  displayedUrl?: string;
};

type SearchItem = {
  searchQuery?: { term?: string };
  query?: string;
  organicResults?: SearchResult[];
  nonPromotedSearchResults?: SearchResult[];
  results?: SearchResult[];
};

type LeadCandidate = Omit<BuyerLead, "id" | "campaign_id" | "created_at" | "updated_at">;

const CONTENT_PATH_PATTERN =
  /\/(blog|news|newsroom|press|press-releases|news-releases|insights|resources|customers|customer-stories|case-studies?|articles?|learn|build)\//;

const SECOND_LEVEL_SUFFIXES = new Set([
  "co.uk",
  "com.au",
  "com.br",
  "com.mx",
  "com.tr",
  "com.sg",
  "co.in",
  "co.jp",
  "co.nz",
  "co.za",
]);

function registrableDomain(hostname: string) {
  const parts = hostname.replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const suffix = parts.slice(-2).join(".");
  return SECOND_LEVEL_SUFFIXES.has(suffix) ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
}

function sourcePath(url: string) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function domainLabelFromHost(hostname: string) {
  return registrableDomain(hostname).split(".")[0] || hostname.split(".")[0] || "Company";
}

function companyFromTitle(title?: string, url?: string) {
  const host = domainFromUrl(url ?? "");
  const label = domainLabelFromHost(host);
  const labelPattern = new RegExp(label.replace(/[-_]/g, "[-_\\s]?"), "i");
  const segments = (title ?? "")
    .split(/\s+[|–—]\s+|\s+-\s+|\s*:\s+/)
    .map((segment) =>
      segment
        .replace(/\b(launches|announces|introduces|unveils|raises|selected by|partners with|case study|blog)\b.*$/i, "")
        .replace(/,\s*(?:ai|automotive|vehicle|software|the)\b.*$/i, "")
        .replace(/\b(home|official site|contact|pricing|request demo)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((segment) => !/^(us|about us|home|contact|pricing|request demo)$/i.test(segment))
    .filter(Boolean);

  const matched = segments.find((segment) => labelPattern.test(segment));
  const clean = matched || segments.find((segment) => !/\b(ai|vehicle inspection|software|technology|overview)\b/i.test(segment));
  if (clean && clean.length >= 2 && clean.length <= 40) return clean;
  return titleCase(label);
}

function isLikelyEditorialResult(title: string | undefined, url: string, domain: string) {
  const path = sourcePath(url);
  const text = `${title || ""} ${domain} ${path}`.toLowerCase();
  return (
    /\b(top|best)\s+\d+\b/.test(text) ||
    /\b(best|top)\b.{0,80}\b(companies|software|tools|platforms|solutions)\b/.test(text) ||
    /\b(list of|companies in|companies for|market report|industry trends|guide|blog|case study|wikipedia|reddit|pilot shows|new ai engine)\b/.test(text) ||
    CONTENT_PATH_PATTERN.test(path) ||
    /(n-ix|medium|forbes|techcrunch|builtin|g2|capterra|wikipedia|reddit|statista|autoremarketing|autonews|capacity|support\.billsby|linkedin|facebook|ycombinator|prospeo|prnewswire|dealershipguy)\./.test(text)
  );
}

function localBuyerFitScore(campaign: DomainCampaign, buyer: LeadCandidate) {
  const words = splitDomainWords(campaign.domain);
  const haystack = [
    buyer.company_name,
    buyer.website,
    buyer.buyer_category,
    buyer.reason_fit,
    buyer.current_domain_weakness,
    buyer.source_url,
  ]
    .join(" ")
    .toLowerCase();

  let score = 45;
  const automotiveDomain = words.some((word) => ["car", "cars", "auto", "autos", "vehicle", "vehicles"].includes(word));
  if (automotiveDomain) {
    if (/\b(auto|automotive|car|cars|vehicle|dealer|dealership|bdc|fleet)\b/.test(haystack)) score += 18;
    if (/\b(ai|agent|assistant|computer vision|inspection|shopping|lifecycle|inventory|conversational)\b|\.ai\b/.test(haystack)) {
      score += 17;
    }
  } else {
    const overlap = words.filter((word) => haystack.includes(word)).length;
    score += Math.min(24, overlap * 8);
  }

  if (buyer.contact_email) score += 8;
  if (buyer.contact_phone) score += 8;
  else if (buyer.contact_url) score += 2;

  if (campaign.domain.endsWith(".ai") && !buyer.current_domain.endsWith(".ai")) score += 5;
  if (!CONTENT_PATH_PATTERN.test(sourcePath(buyer.source_url))) score += 4;
  else score -= 8;

  return Math.max(15, Math.min(92, score));
}


function inferWeakness(currentDomain: string, campaignDomain: string) {
  const normalized = normalizeDomain(currentDomain);
  const target = normalizeDomain(campaignDomain);
  if (!normalized) return "Current domain could not be verified from search result.";
  if (normalized.includes("-")) return "Current domain uses a hyphen and is less clean for outbound recall.";
  if (target.endsWith(".ai") && !normalized.endsWith(".ai")) {
    return "Current domain is not .ai while the campaign domain is a direct AI category fit.";
  }
  if (normalized.length > target.length + 8) {
    return "Current domain is materially longer than the target domain.";
  }
  return "Current domain is usable, but less directly tied to this specific category.";
}

function searchItemsToCandidates(
  campaign: DomainCampaign,
  analysis: DomainAnalysis,
  items: SearchItem[],
): LeadCandidate[] {
  const seen = new Set<string>();
  const candidates: LeadCandidate[] = [];
  const categories = analysis.buyer_categories.length ? analysis.buyer_categories : ["Relevant software companies"];

  for (const item of items) {
    const query = item.searchQuery?.term || item.query || analysis.suggested_search_queries[0] || campaign.use_case_thesis;
    const results = item.organicResults || item.nonPromotedSearchResults || item.results || [];

    for (const result of results) {
      const url = result.url || result.link;
      if (!url) continue;
      const rawDomain = domainFromUrl(url);
      const currentDomain = registrableDomain(rawDomain);
      if (!currentDomain || seen.has(currentDomain)) continue;
      if (/(linkedin|facebook|x\.com|twitter|youtube|crunchbase|g2|capterra|wikipedia|reddit|ycombinator|prospeo|prnewswire|autonews)\./i.test(currentDomain)) {
        continue;
      }
      if (isLikelyEditorialResult(result.title, url, rawDomain)) continue;

      seen.add(currentDomain);
      const companyName = companyFromTitle(result.title, url);
      const category = categories.find((candidate) => query.toLowerCase().includes(candidate.split(" ")[0].toLowerCase())) || categories[0];
      const description = result.description || result.snippet || "";

      candidates.push({
        company_name: companyName,
        website: `https://${currentDomain}`,
        current_domain: currentDomain,
        buyer_category: category,
        fit_score: 60,
        reason_fit: `${companyName} appeared in search for "${query}". ${analysis.positioning_statement} ${description}`.trim(),
        current_domain_weakness: inferWeakness(currentDomain, campaign.domain),
        contact_email: "",
        contact_url: `https://${currentDomain}/contact`,
        decision_maker_name: "",
        decision_maker_role: "Founder, growth, or product marketing",
        source_url: url,
        status: "new",
      });

      if (candidates.length >= 20) return candidates;
    }
  }

  return candidates;
}

async function runApifySearch(queries: string[]): Promise<SearchItem[]> {
  if (!apifyAllowed()) return [];

  const requestedQueries = queries.slice(0, 4);
  const endpoint = apifyRunSyncDatasetUrl("apify/google-search-scraper", 60);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queries: requestedQueries.join("\n"),
      resultsPerPage: 8,
      maxPagesPerQuery: 1,
      languageCode: "en",
      countryCode: "us",
    }),
  });

  if (!response.ok) {
    throw new Error(`Apify search failed: ${response.status}`);
  }

  const normalizedOrder = new Map(
    requestedQueries.map((query, index) => [query.replace(/"/g, "").toLowerCase(), index]),
  );

  return ((await response.json()) as SearchItem[]).sort((left, right) => {
    const leftQuery = (left.searchQuery?.term || left.query || "").replace(/"/g, "").toLowerCase();
    const rightQuery = (right.searchQuery?.term || right.query || "").replace(/"/g, "").toLowerCase();
    return (normalizedOrder.get(leftQuery) ?? 999) - (normalizedOrder.get(rightQuery) ?? 999);
  });
}

function categoryExpansionQueries(campaign: DomainCampaign, analysis: DomainAnalysis) {
  const words = splitDomainWords(campaign.domain);
  const queryParts = new Set<string>();

  if (words.some((word) => ["car", "cars", "auto", "autos", "vehicle", "vehicles"].includes(word))) {
    [
      "AI car dealership software startup",
      "\"AI vehicle inspection\" \"contact\"",
      "\"AI car shopping assistant\" \"contact\"",
      "\"automotive AI\" \"dealer\" \"contact\"",
      "\"AI for car dealerships\" \"request demo\"",
      "\"AI BDC\" \"car dealers\"",
      "\"automotive inventory AI\" \"request demo\"",
      "AI used car marketplace startup",
    ].forEach((query) => queryParts.add(query));
  }

  for (const word of words) {
    queryParts.add(`${word} AI startup`);
    queryParts.add(`${word} software company`);
    queryParts.add(`${word} marketplace AI`);
  }

  (analysis.suggested_search_queries || []).forEach((query) => queryParts.add(query));
  analysis.buyer_categories.forEach((category) => queryParts.add(`${category} ${campaign.use_case_thesis || campaign.domain}`));

  return [...queryParts].filter(Boolean).slice(0, 10);
}

export async function discoverBuyers(campaign: DomainCampaign, analysis: DomainAnalysis) {
  const queries = categoryExpansionQueries(campaign, analysis);

  let candidates: Omit<BuyerLead, "id" | "campaign_id" | "created_at" | "updated_at">[] = [];
  try {
    const items = await runApifySearch(queries);
    candidates = searchItemsToCandidates(campaign, analysis, items);
  } catch {
    candidates = [];
  }

  const enriched = await enrichLeadContacts(candidates.slice(0, 15));

  const scored = await Promise.all(
    enriched.map(async (candidate) => {
      const score = await scoreBuyer(campaign.domain, campaign, candidate);
      return {
        ...candidate,
        fit_score: Math.max(Math.round(score.score), localBuyerFitScore(campaign, candidate)),
        reason_fit: score.explanation || candidate.reason_fit,
        outreach_angle: score.recommended_outreach_angle,
        status: "scored" as const,
      };
    }),
  );

  return scored.sort((a, b) => b.fit_score - a.fit_score).slice(0, 20);
}
