import type { BuyerLead } from "@/lib/types";
import { apifyAllowed, apifyRunSyncDatasetUrl } from "@/lib/apifyClient";
import { domainFromUrl, normalizeDomain } from "@/lib/format";

type LeadInput = Omit<BuyerLead, "id" | "campaign_id" | "created_at" | "updated_at">;

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
    `${origin}/about`,
    `${origin}/team`,
    `${origin}/company`,
    `${origin}/leadership`,
  ]).slice(0, 5);
}

function extractEmails(text: string, domain: string) {
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const blocked = new Set(["example.com", "domain.com"]);
  const emails = unique((text.match(emailRegex) || []).map((email) => email.toLowerCase()))
    .filter((email) => !blocked.has(email.split("@")[1]))
    .filter((email) => !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(email));

  const siteDomain = normalizeDomain(domain).replace(/^www\./, "");
  const sameDomainEmails = emails.filter((email) => {
    const emailDomain = email.split("@")[1] || "";
    return emailDomain === siteDomain || emailDomain.endsWith(`.${siteDomain}`);
  });
  const usefulGeneric = sameDomainEmails.find((email) => /^(hello|contact|sales|partnerships|info|team|growth)@/i.test(email));
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

async function fetchWithTimeout(url: string, timeoutMs = 3500) {
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
    if (pages.length >= 3) break;
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
        maxCrawlPages: Math.min(urls.length, 5),
        maxCrawlDepth: 0,
        crawlerType: "cheerio",
        saveHtml: true,
        saveMarkdown: true,
      }),
    });
    if (!response.ok) return [];
    const items = (await response.json()) as ApifyContentItem[];
    return items
      .slice(0, 3)
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

export async function enrichLeadContact(lead: LeadInput): Promise<LeadInput> {
  const urls = candidateUrls(lead);
  const apifyPages = await apifyFetchPages(urls);
  const pages = apifyPages.length > 0 ? apifyPages : await directFetchPages(urls);
  const combinedText = pages.map((page) => `${page.title || ""} ${page.url} ${page.text}`).join("\n").slice(0, 25000);
  const websiteDomain = domainFromUrl(lead.website || lead.current_domain);
  const email = extractEmails(combinedText, websiteDomain);
  const phone = extractPhone(combinedText);
  const contactUrl = extractContactUrl(pages, lead.contact_url || urls[0] || lead.website);
  const decisionMaker = extractDecisionMaker(combinedText);

  return {
    ...lead,
    contact_email: email || lead.contact_email,
    contact_url: contactUrl || lead.contact_url,
    contact_phone: phone || lead.contact_phone,
    phone_source_url: phone ? pages.find((page) => page.text.includes(phone.replace("+1 ", "")))?.url || contactUrl : lead.phone_source_url,
    decision_maker_name: decisionMaker.name || lead.decision_maker_name,
    decision_maker_role: decisionMaker.role || lead.decision_maker_role || "Founder, growth, or business development",
    reason_fit: pages.length
      ? `${lead.reason_fit} Contact enrichment checked ${pages.length} public page${pages.length === 1 ? "" : "s"}.`
      : lead.reason_fit,
  };
}

export async function enrichLeadContacts(leads: LeadInput[]) {
  return Promise.all(leads.slice(0, 15).map((lead) => enrichLeadContact(lead)));
}
