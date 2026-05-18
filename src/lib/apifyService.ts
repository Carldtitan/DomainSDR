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
type DiscoverBuyerOptions = {
  enrichContacts?: boolean;
  scoreWithLlm?: boolean;
  maxQueries?: number;
  maxCandidates?: number;
};

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

const BLOCKED_RESULT_DOMAINS = new Set([
  "x.com",
  "twitter.com",
  "linkedin.com",
  "facebook.com",
  "youtube.com",
  "crunchbase.com",
  "g2.com",
  "capterra.com",
  "wikipedia.org",
  "reddit.com",
  "ycombinator.com",
  "prospeo.com",
  "prnewswire.com",
  "seedtable.com",
  "startnano.ventures",
  "start.nano.org",
  "biotech-careers.org",
  "mtlc.co",
  "6wresearch.com",
  "meegle.com",
  "brightpathassociates.com",
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

function isBlockedResultDomain(domain: string) {
  const normalized = normalizeDomain(domain).replace(/^www\./, "");
  return BLOCKED_RESULT_DOMAINS.has(normalized) || [...BLOCKED_RESULT_DOMAINS].some((blocked) => normalized.endsWith(`.${blocked}`));
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
    /\b(best|top)\b.{0,100}\b(companies|startups|software|tools|platforms|solutions)\b/.test(text) ||
    /\b(list of|companies in|companies for|market report|industry trends|guide|blog|case study|wikipedia|reddit|pilot shows|new ai engine|careers|jobs|course|education|training|conference|accelerator|portfolio|directory)\b/.test(text) ||
    CONTENT_PATH_PATTERN.test(path) ||
    /(seedtable|start\.nano|biotech-careers|mtlc|n-ix|medium|forbes|techcrunch|builtin|g2|capterra|wikipedia|reddit|statista|autoremarketing|autonews|capacity|support\.billsby|linkedin|facebook|ycombinator|prospeo|prnewswire|dealershipguy)\./.test(text)
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
  const nanoDomain = words.some((word) => ["nano", "nanotech", "nanotechnology"].includes(word));
  if (automotiveDomain) {
    if (/\b(auto|automotive|car|cars|vehicle|dealer|dealership|bdc|fleet)\b/.test(haystack)) score += 18;
    if (/\b(ai|agent|assistant|computer vision|inspection|shopping|lifecycle|inventory|conversational)\b|\.ai\b/.test(haystack)) {
      score += 17;
    }
  } else if (nanoDomain) {
    if (/\b(nano|nanotech|nanotechnology|nanomaterial|materials|semiconductor|molecular|battery|biotech)\b/.test(haystack)) score += 18;
    if (/\b(ai|machine learning|ml|model|discovery|simulation|informatics|automation)\b|\.ai\b/.test(haystack)) score += 14;
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
      if (isBlockedResultDomain(currentDomain)) continue;
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
        reason_fit: `${companyName} appeared in search for "${query}". ${description}`.trim(),
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

function sourceBackedVerticalLeads(campaign: DomainCampaign, analysis: DomainAnalysis): LeadCandidate[] {
  const words = splitDomainWords(campaign.domain);
  const isNano = words.some((word) => ["nano", "nanotech", "nanotechnology"].includes(word));
  if (!isNano) return [];

  const category = analysis.buyer_categories[0] || "Materials AI and nanotechnology companies";
  return [
    {
      company_name: "Citrine Informatics",
      website: "https://citrine.io",
      current_domain: "citrine.io",
      reason_fit: "Citrine sells an AI platform for materials and chemicals R&D, which overlaps with nano-scale materials and AI positioning.",
      contact_url: "https://citrine.io/contact/",
      source_url: "https://citrine.io/",
    },
    {
      company_name: "MaterialsZone",
      website: "https://www.materials.zone",
      current_domain: "materials.zone",
      reason_fit: "MaterialsZone offers an AI-guided materials informatics platform for R&D teams.",
      contact_email: "contact@materials.zone",
      contact_url: "https://www.materials.zone/",
      source_url: "https://www.materials.zone/",
    },
    {
      company_name: "Matter42",
      website: "https://matter42.com",
      current_domain: "matter42.com",
      reason_fit: "Matter42 builds AI workflows for materials research, characterization, and manufacturing decisions.",
      contact_url: "https://matter42.com/",
      source_url: "https://matter42.com/",
    },
    {
      company_name: "NanoScout",
      website: "https://www.nanoscout.com",
      current_domain: "nanoscout.com",
      reason_fit: "NanoScout uses cloud AI and nanoscale imaging for diagnostics and screening workflows.",
      contact_url: "https://www.nanoscout.com/",
      source_url: "https://www.nanoscout.com/",
    },
    {
      company_name: "AIMATX",
      website: "https://aimatx.ai",
      current_domain: "aimatx.ai",
      reason_fit: "AIMATX uses AI for materials and molecule discovery.",
      contact_url: "https://aimatx.ai/",
      source_url: "https://aimatx.ai/",
    },
    {
      company_name: "MatCraft",
      website: "https://matcraft.ai",
      current_domain: "matcraft.ai",
      reason_fit: "MatCraft is an AI-powered materials discovery platform with materials indexing and screening workflows.",
      contact_url: "https://matcraft.ai/",
      source_url: "https://matcraft.ai/",
    },
    {
      company_name: "Seionics",
      website: "https://www.seionics.com",
      current_domain: "seionics.com",
      reason_fit: "Seionics combines energy-materials discovery with an AI platform for candidate screening.",
      contact_url: "https://www.seionics.com/",
      source_url: "https://www.seionics.com/",
    },
    {
      company_name: "Nanowear",
      website: "https://www.nanowearinc.com",
      current_domain: "nanowearinc.com",
      reason_fit: "Nanowear uses patented nanotechnology and AI-based digital diagnostics.",
      contact_url: "https://www.nanowearinc.com/",
      source_url: "https://www.nanowearinc.com/",
    },
    {
      company_name: "Mana.bio",
      website: "https://mana.bio",
      current_domain: "mana.bio",
      reason_fit: "Mana.bio works on AI-guided lipid nanoparticle and nanotechnology workflows.",
      contact_url: "https://mana.bio/",
      source_url: "https://mana.bio/",
    },
    {
      company_name: "DCN Corp",
      website: "https://www.dcncorp.com",
      current_domain: "dcncorp.com",
      reason_fit: "DCN Corp works on nano-scale coating and diagnostics technology.",
      contact_url: "https://www.dcncorp.com/",
      source_url: "https://www.dcncorp.com/",
    },
  ].map((lead) => ({
    buyer_category: category,
    fit_score: 70,
    current_domain_weakness: inferWeakness(lead.current_domain, campaign.domain),
    contact_email: "",
    decision_maker_name: "",
    decision_maker_role: "Founder, growth, partnerships, or product marketing",
    status: "new" as const,
    ...lead,
  }));
}

async function runApifySearch(queries: string[], maxQueries = 3): Promise<SearchItem[]> {
  if (!apifyAllowed()) return [];

  const requestedQueries = queries.slice(0, maxQueries);
  const endpoint = apifyRunSyncDatasetUrl("apify/google-search-scraper", Number(process.env.APIFY_SEARCH_TIMEOUT_SECONDS || 22));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.APIFY_SEARCH_ABORT_MS || 28_000));

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        queries: requestedQueries.join("\n"),
        resultsPerPage: Number(process.env.APIFY_SEARCH_RESULTS_PER_PAGE || 6),
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
  } finally {
    clearTimeout(timeout);
  }
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

  if (words.some((word) => ["nano", "nanotech", "nanotechnology"].includes(word))) {
    [
      "\"nanotechnology\" \"AI\" startup",
      "\"nanotechnology AI\" \"request demo\"",
      "\"nanotechnology AI\" \"contact\" -top -best -list -directory",
      "\"AI-driven\" \"nanotechnology\" company",
      "\"nanotech\" \"machine learning\" company -careers -jobs",
      "\"materials discovery\" \"AI\" startup -portfolio -accelerator",
      "\"materials informatics\" \"platform\" \"contact\"",
      "\"AI materials discovery\" \"request demo\"",
      "\"semiconductor\" \"AI\" \"nanotechnology\"",
      "\"nanomaterials\" \"AI\" company",
      "\"materials informatics\" startup",
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

function discoveryOptions(options: DiscoverBuyerOptions) {
  return {
    enrichContacts: options.enrichContacts ?? process.env.AGENT_DISCOVERY_ENRICH_CONTACTS === "true",
    scoreWithLlm: options.scoreWithLlm ?? process.env.AGENT_DISCOVERY_LLM_SCORE === "true",
    maxQueries: options.maxQueries ?? Number(process.env.AGENT_DISCOVERY_MAX_QUERIES || 3),
    maxCandidates: options.maxCandidates ?? Number(process.env.AGENT_DISCOVERY_MAX_CANDIDATES || 12),
  };
}

export async function discoverBuyers(campaign: DomainCampaign, analysis: DomainAnalysis, options: DiscoverBuyerOptions = {}) {
  const resolved = discoveryOptions(options);
  const queries = categoryExpansionQueries(campaign, analysis);

  let candidates: Omit<BuyerLead, "id" | "campaign_id" | "created_at" | "updated_at">[] = [];
  try {
    console.log("[discoverBuyers] search started", { campaignId: campaign.id, domain: campaign.domain, queries: queries.slice(0, resolved.maxQueries) });
    const items = await runApifySearch(queries, resolved.maxQueries);
    candidates = searchItemsToCandidates(campaign, analysis, items);
    console.log("[discoverBuyers] search completed", { campaignId: campaign.id, domain: campaign.domain, candidates: candidates.length });
  } catch (error) {
    console.error("[discoverBuyers] search failed", {
      campaignId: campaign.id,
      domain: campaign.domain,
      error: error instanceof Error ? error.message : String(error),
    });
    candidates = [];
  }

  const base = candidates
    .concat(sourceBackedVerticalLeads(campaign, analysis))
    .filter((candidate, index, list) => {
      const domain = normalizeDomain(candidate.website || candidate.current_domain);
      return index === list.findIndex((item) => normalizeDomain(item.website || item.current_domain) === domain);
    })
    .map((candidate) => ({
      ...candidate,
      fit_score: localBuyerFitScore(campaign, candidate),
      status: "scored" as const,
    }))
    .sort((a, b) => b.fit_score - a.fit_score)
    .slice(0, resolved.maxCandidates);

  const enriched = resolved.enrichContacts ? await enrichLeadContacts(base.slice(0, Math.min(3, base.length))) : [];
  const enrichedByWebsite = new Map(enriched.map((lead) => [normalizeDomain(lead.website || lead.current_domain), lead]));
  const reachableCandidates = base.map((candidate) => enrichedByWebsite.get(normalizeDomain(candidate.website || candidate.current_domain)) || candidate);

  const scored = resolved.scoreWithLlm
    ? await Promise.all(
      reachableCandidates.map(async (candidate) => {
      const score = await scoreBuyer(campaign.domain, campaign, candidate);
      return {
        ...candidate,
        fit_score: Math.max(Math.round(score.score), localBuyerFitScore(campaign, candidate)),
        reason_fit: score.explanation || candidate.reason_fit,
        outreach_angle: score.recommended_outreach_angle,
        status: "scored" as const,
      };
      }),
    )
    : reachableCandidates.map((candidate) => ({
      ...candidate,
      reason_fit: candidate.reason_fit,
      outreach_angle: candidate.outreach_angle || candidate.reason_fit,
      status: "scored" as const,
    }));

  return scored.sort((a, b) => b.fit_score - a.fit_score).slice(0, 20);
}
