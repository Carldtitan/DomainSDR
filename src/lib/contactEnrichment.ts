import type { BuyerLead } from "@/lib/types";
import { apifyAllowed, apifyRunSyncDatasetUrl } from "@/lib/apifyClient";
import { browserUseFindContacts } from "@/lib/browserUseService";
import { domainFromUrl, normalizeDomain } from "@/lib/format";
import { saveEmailPatternMemory, searchEmailPatternMemory } from "@/lib/supermemoryService";

type LeadInput = Omit<BuyerLead, "id" | "campaign_id" | "created_at" | "updated_at">;
type EnrichOptions = {
  browserFallback?: boolean;
};

type PageContent = {
  url: string;
  title?: string;
  text: string;
  html?: string;
};

type ApifyContentItem = {
  url?: string;
  loadedUrl?: string;
  title?: string;
  text?: string;
  markdown?: string;
  html?: string;
  description?: string;
};

const ROLE_PATTERN =
  "(Founder|Co-Founder|CEO|Chief Executive Officer|CMO|Chief Marketing Officer|Head of Growth|VP Marketing|Growth Lead|Partnerships|Business Development)";

const GENERIC_INBOXES = new Set([
  "admin",
  "bd",
  "bizdev",
  "contact",
  "founder",
  "founders",
  "growth",
  "hello",
  "info",
  "partnership",
  "partnerships",
  "sales",
  "support",
  "team",
]);

function cleanText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function unique<T>(values: T[]) {
  return [...new Set(values.filter(Boolean))];
}

function candidateUrls(lead: LeadInput) {
  const base = lead.website.startsWith("http") ? lead.website : `https://${lead.website}`;
  const origin = (() => {
    try {
      return new URL(base).origin;
    } catch {
      return `https://${domainFromUrl(base)}`;
    }
  })();

  return unique([
    lead.contact_url,
    base,
    `${origin}/contact`,
    `${origin}/contact-us`,
    `${origin}/sales`,
    `${origin}/demo`,
    `${origin}/request-demo`,
    `${origin}/book-a-demo`,
    `${origin}/about`,
    `${origin}/about-us`,
    `${origin}/team`,
    `${origin}/company`,
    `${origin}/leadership`,
    `${origin}/support`,
    `${origin}/privacy`,
    `${origin}/terms`,
  ]).slice(0, Number(process.env.CONTACT_ENRICH_MAX_URLS || 4));
}

function extractEmails(text: string, domain: string) {
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const blocked = new Set(["example.com", "domain.com"]);
  const mailtoRegex = /mailto:([^"'>?\s]+)/gi;
  const obfuscatedRegex =
    /([A-Z0-9._%+-]+)\s*(?:\(|\[)?\s*(?:at)\s*(?:\)|\])?\s*([A-Z0-9.-]+)\s*(?:\(|\[)?\s*(?:dot)\s*(?:\)|\])?\s*([A-Z]{2,})/gi;
  const mailtoEmails = [...text.matchAll(mailtoRegex)].map((match) => decodeURIComponent(match[1]).toLowerCase());
  const obfuscatedEmails = [...text.matchAll(obfuscatedRegex)].map((match) =>
    `${match[1]}@${match[2]}.${match[3]}`.toLowerCase(),
  );
  const emails = unique([...(text.match(emailRegex) || []), ...mailtoEmails, ...obfuscatedEmails].map((email) => email.toLowerCase()))
    .filter((email) => !blocked.has(email.split("@")[1]))
    .filter((email) => !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(email));

  const siteDomain = normalizeDomain(domain).replace(/^www\./, "");
  const sameDomainEmails = emails.filter((email) => {
    const emailDomain = email.split("@")[1] || "";
    return emailDomain === siteDomain || emailDomain.endsWith(`.${siteDomain}`);
  });
  const usefulGeneric = sameDomainEmails.find((email) => /^(hello|contact|sales|partnerships|partnership|info|team|growth|founders|founder|bd|bizdev|support)@/i.test(email));
  return usefulGeneric || sameDomainEmails[0] || "";
}

function normalizePhone(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1 ${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length >= 10 && digits.length <= 15 && trimmed.startsWith("+")) {
    return `+${digits}`;
  }
  return "";
}

function extractPhone(text: string) {
  const phoneRegex = /(?:\+?1[\s.-]?)?(?:\(?[2-9]\d{2}\)?[\s.-]?)?[2-9]\d{2}[\s.-]?\d{4}/g;
  const blocked = new Set(["0000000000", "1111111111", "1234567890", "2015550123"]);
  for (const match of text.match(phoneRegex) || []) {
    const digits = match.replace(/\D/g, "");
    const normalizedDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (blocked.has(normalizedDigits)) continue;
    const phone = normalizePhone(match);
    if (phone) return phone;
  }
  return "";
}

function extractContactUrl(pages: PageContent[], fallback: string) {
  const linkRegex = /href=["']([^"']+)["'][^>]*>([^<]{0,80})/gi;
  for (const page of pages) {
    const html = page.html || "";
    for (const match of html.matchAll(linkRegex)) {
      const href = match[1];
      const label = `${href} ${match[2]}`.toLowerCase();
      if (!/(contact|demo|sales|partnership|support)/.test(label)) continue;
      try {
        return new URL(href, page.url).toString();
      } catch {
        return href;
      }
    }
  }
  return fallback;
}

function extractDecisionMaker(text: string) {
  const name = "([A-Z][a-zA-Z'.-]+\\s+[A-Z][a-zA-Z'.-]+)";
  const afterName = new RegExp(`${name}\\s*(?:,|-|–|—)?\\s*${ROLE_PATTERN}`, "i");
  const beforeName = new RegExp(`${ROLE_PATTERN}\\s*(?:,|-|–|—|:)?\\s*${name}`, "i");

  const after = text.match(afterName);
  if (after) {
    return { name: after[1], role: after[2] };
  }

  const before = text.match(beforeName);
  if (before) {
    return { name: before[2], role: before[1] };
  }

  const roleOnly = text.match(new RegExp(ROLE_PATTERN, "i"));
  return { name: "", role: roleOnly?.[1] || "" };
}

function normalizeNameParts(name?: string) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z\s-]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean);
}

function inferEmailPattern(email: string, decisionMakerName?: string) {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain) return "";
  if (GENERIC_INBOXES.has(local)) return `generic:${local}@`;

  const parts = normalizeNameParts(decisionMakerName);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last || first === last) return "person:unknown";

  if (local === `${first}.${last}`) return "first.last@";
  if (local === `${first}_${last}`) return "first_last@";
  if (local === `${first}${last}`) return "firstlast@";
  if (local === `${first[0]}${last}`) return "flast@";
  if (local === `${first}${last[0]}`) return "firstl@";
  if (local === first) return "first@";
  return "person:unknown";
}

async function rememberEmailPattern(lead: LeadInput, email: string, sourceUrl?: string) {
  const domain = email.split("@")[1] || domainFromUrl(lead.website || lead.current_domain);
  const pattern = inferEmailPattern(email, lead.decision_maker_name);
  if (!domain || !pattern) return;
  await saveEmailPatternMemory({
    domain,
    companyName: lead.company_name,
    pattern,
    exampleEmail: email,
    sourceUrl,
  });
}

async function fetchWithTimeout(url: string, timeoutMs = Number(process.env.CONTACT_FETCH_TIMEOUT_MS || 2500)) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "DomainSDR contact enrichment; low-volume domain sale research",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
    });
    if (!response.ok || !response.headers.get("content-type")?.match(/text|html|json/i)) return undefined;
    const html = await response.text();
    return { url: response.url || url, html, text: cleanText(html) };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function directFetchPages(urls: string[]) {
  const pages: PageContent[] = [];
  for (const url of urls) {
    const page = await fetchWithTimeout(url);
    if (page?.text) pages.push(page);
    if (pages.length >= Number(process.env.CONTACT_DIRECT_MAX_PAGES || 3)) break;
  }
  return pages;
}

async function apifyFetchPages(urls: string[]) {
  if (!apifyAllowed() || process.env.ALLOW_APIFY_CONTACT_ENRICHMENT !== "true") return [];

  const endpoint = apifyRunSyncDatasetUrl("apify/website-content-crawler", 70);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: urls.map((url) => ({ url })),
        maxCrawlPages: Math.min(urls.length, 8),
        maxCrawlDepth: 0,
        crawlerType: "cheerio",
        saveHtml: true,
        saveMarkdown: true,
      }),
    });
    if (!response.ok) return [];
    const items = (await response.json()) as ApifyContentItem[];
    return items
      .slice(0, 6)
      .map((item) => ({
        url: item.loadedUrl || item.url || "",
        title: item.title,
        text: cleanText(item.text || item.markdown || item.description || item.html || ""),
        html: item.html,
      }))
      .filter((item) => item.url && item.text);
  } catch {
    return [];
  }
}

async function apifySearchContactSnippets(lead: LeadInput) {
  if (!apifyAllowed() || process.env.ALLOW_APIFY_CONTACT_ENRICHMENT !== "true") return "";
  const domain = normalizeDomain(domainFromUrl(lead.website || lead.current_domain));
  if (!domain) return "";
  const endpoint = apifyRunSyncDatasetUrl("apify/google-search-scraper", 45);
  const queries = [
    `site:${domain} email OR phone OR contact`,
    `site:${domain} "mailto:"`,
    `"${lead.company_name}" "@"`,
    `"${lead.company_name}" "sales" "email"`,
    `"${lead.company_name}" "phone"`,
  ];

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries: queries.join("\n"),
        resultsPerPage: 4,
        maxPagesPerQuery: 1,
        languageCode: "en",
        countryCode: "us",
      }),
    });
    if (!response.ok) return "";
    const items = (await response.json()) as {
      organicResults?: { title?: string; url?: string; description?: string; snippet?: string }[];
      nonPromotedSearchResults?: { title?: string; url?: string; description?: string; snippet?: string }[];
      results?: { title?: string; url?: string; description?: string; snippet?: string }[];
    }[];
    return items
      .flatMap((item) => item.organicResults || item.nonPromotedSearchResults || item.results || [])
      .map((item) => `${item.title || ""} ${item.url || ""} ${item.description || ""} ${item.snippet || ""}`)
      .join("\n")
      .slice(0, 12000);
  } catch {
    return "";
  }
}

async function enrichLeadContactCore(lead: LeadInput): Promise<LeadInput> {
  const urls = candidateUrls(lead);
  const apifyPages = await apifyFetchPages(urls);
  const pages = apifyPages.length > 0 ? apifyPages : await directFetchPages(urls);
  const combinedText = pages.map((page) => `${page.title || ""} ${page.url} ${page.text} ${page.html || ""}`).join("\n").slice(0, 30000);
  const websiteDomain = domainFromUrl(lead.website || lead.current_domain);
  const pageEmail = extractEmails(combinedText, websiteDomain);
  const pagePhone = extractPhone(combinedText);
  const searchText = pageEmail && pagePhone ? "" : await apifySearchContactSnippets(lead);
  const allText = `${combinedText}\n${searchText}`.slice(0, 35000);
  const email = pageEmail || extractEmails(searchText, websiteDomain);
  const phone = pagePhone || extractPhone(searchText);
  const contactUrl = extractContactUrl(pages, lead.contact_url || urls[0] || lead.website);
  const decisionMaker = extractDecisionMaker(allText);
  const enriched = {
    ...lead,
    contact_email: email || lead.contact_email,
    contact_url: contactUrl || lead.contact_url,
    contact_phone: phone || lead.contact_phone,
    phone_source_url: phone ? pages.find((page) => page.text.includes(phone.replace("+1 ", "")))?.url || contactUrl : lead.phone_source_url,
    decision_maker_name: decisionMaker.name || lead.decision_maker_name,
    decision_maker_role: decisionMaker.role || lead.decision_maker_role || "Founder, growth, or business development",
    reason_fit: pages.length || searchText
      ? `${lead.reason_fit} Contact enrichment checked ${pages.length} public page${pages.length === 1 ? "" : "s"}${searchText ? " and search snippets" : ""}.`
      : lead.reason_fit,
  };

  if (enriched.contact_email) {
    await rememberEmailPattern(enriched, enriched.contact_email, contactUrl || pages[0]?.url);
  }

  return enriched;
}

async function applyBrowserFallback(lead: LeadInput) {
  if (lead.contact_email) return lead;
  const domain = domainFromUrl(lead.website || lead.current_domain);
  const memory = await searchEmailPatternMemory(`${lead.company_name} ${domain}`);
  const contact = await browserUseFindContacts(lead, memory.join("\n").slice(0, 1200));
  if (!contact) return lead;

  const enriched = {
    ...lead,
    contact_email: contact.contact_email || lead.contact_email,
    contact_url: contact.contact_url || lead.contact_url,
    contact_phone: contact.contact_phone || lead.contact_phone,
    phone_source_url: contact.contact_phone ? contact.source_url || contact.contact_url || lead.phone_source_url : lead.phone_source_url,
    decision_maker_name: contact.decision_maker_name || lead.decision_maker_name,
    decision_maker_role: contact.decision_maker_role || lead.decision_maker_role,
    reason_fit: contact.notes ? `${lead.reason_fit} Browser contact check: ${contact.notes}` : lead.reason_fit,
  };

  if (enriched.contact_email) {
    await rememberEmailPattern(enriched, enriched.contact_email, contact.source_url || enriched.contact_url);
  }

  return enriched;
}

export async function enrichLeadContact(lead: LeadInput, options: EnrichOptions = {}): Promise<LeadInput> {
  const enriched = await enrichLeadContactCore(lead);
  if (options.browserFallback === false) return enriched;
  return applyBrowserFallback(enriched);
}

export async function enrichLeadContacts(leads: LeadInput[]) {
  const enriched = await Promise.all(leads.slice(0, 15).map((lead) => enrichLeadContactCore(lead)));
  const browserFallbackLimit = Number(process.env.BROWSER_USE_CONTACT_MAX_LEADS || 1);
  const output: LeadInput[] = [];
  let browserFallbacks = 0;

  for (const lead of enriched) {
    if (!lead.contact_email && browserFallbacks < browserFallbackLimit) {
      output.push(await applyBrowserFallback(lead));
      browserFallbacks += 1;
    } else {
      output.push(lead);
    }
  }

  return output;
}
