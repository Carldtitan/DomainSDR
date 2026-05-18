import { domainFromUrl } from "@/lib/format";
import type { BuyerLead } from "@/lib/types";

type LeadInput = Omit<BuyerLead, "id" | "campaign_id" | "created_at" | "updated_at">;

type BrowserUseContactResult = {
  contact_email?: string;
  contact_phone?: string;
  contact_url?: string;
  decision_maker_name?: string;
  decision_maker_role?: string;
  source_url?: string;
  notes?: string;
};

type TaskStatus = {
  status?: "created" | "started" | "finished" | "failed" | "stopped";
  output?: string | null;
  isSuccess?: boolean | null;
};

const BASE_URL = "https://api.browser-use.com/api/v2";

function browserUseEnabled() {
  if (!process.env.BROWSER_USE_API_KEY) return false;
  return process.env.ALLOW_BROWSER_USE_CONTACT_FALLBACK !== "false";
}

function contactSchema() {
  return JSON.stringify({
    type: "object",
    additionalProperties: false,
    properties: {
      contact_email: { type: "string" },
      contact_phone: { type: "string" },
      contact_url: { type: "string" },
      decision_maker_name: { type: "string" },
      decision_maker_role: { type: "string" },
      source_url: { type: "string" },
      notes: { type: "string" },
    },
    required: ["contact_email", "contact_phone", "contact_url", "decision_maker_name", "decision_maker_role", "source_url", "notes"],
  });
}

function parseOutput(output?: string | null): BrowserUseContactResult | undefined {
  if (!output) return undefined;
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as BrowserUseContactResult;
  } catch {
    const json = trimmed.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return undefined;
    try {
      return JSON.parse(json) as BrowserUseContactResult;
    } catch {
      return undefined;
    }
  }
}

function cleanResult(result?: BrowserUseContactResult) {
  if (!result) return undefined;
  const email = result.contact_email?.trim().toLowerCase() || "";
  const phone = result.contact_phone?.trim() || "";
  const contactUrl = result.contact_url?.trim() || result.source_url?.trim() || "";
  if (!email && !phone && !contactUrl) return undefined;
  return {
    contact_email: email,
    contact_phone: phone,
    contact_url: contactUrl,
    decision_maker_name: result.decision_maker_name?.trim() || "",
    decision_maker_role: result.decision_maker_role?.trim() || "",
    source_url: result.source_url?.trim() || contactUrl,
    notes: result.notes?.trim() || "",
  };
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function browserUseFindContacts(lead: LeadInput, memoryHint = "") {
  if (!browserUseEnabled()) return undefined;

  const apiKey = process.env.BROWSER_USE_API_KEY;
  const domain = domainFromUrl(lead.website || lead.current_domain);
  const startUrl = lead.contact_url || lead.website || `https://${domain}`;
  const allowedDomains = domain ? [domain, `www.${domain}`] : undefined;
  const timeoutMs = Number(process.env.BROWSER_USE_CONTACT_TIMEOUT_MS || 25_000);
  const started = Date.now();

  const task = [
    `Find public contact information for ${lead.company_name}.`,
    `Website: ${lead.website || lead.current_domain}.`,
    memoryHint ? `Known email-format memory: ${memoryHint}` : "",
    "Use only public pages. Do not log in. Do not submit forms. Do not guess email addresses.",
    "Prefer a public company-domain email for sales, partnerships, founder, growth, marketing, or business development.",
    "If no email is public, return the best contact form URL and any public phone number.",
    "Return JSON only.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const createResponse = await fetch(`${BASE_URL}/tasks`, {
      method: "POST",
      headers: {
        "X-Browser-Use-API-Key": apiKey || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task,
        startUrl,
        maxSteps: Number(process.env.BROWSER_USE_CONTACT_MAX_STEPS || 18),
        structuredOutput: contactSchema(),
        allowedDomains,
        vision: true,
        metadata: {
          app: "DomainSDR",
          purpose: "contact_enrichment",
          company: lead.company_name.slice(0, 80),
        },
      }),
    });
    const created = (await createResponse.json().catch(() => ({}))) as { id?: string; error?: string; message?: string };
    if (!createResponse.ok || !created.id) return undefined;

    while (Date.now() - started < timeoutMs) {
      await sleep(1500);
      const statusResponse = await fetch(`${BASE_URL}/tasks/${created.id}/status`, {
        headers: { "X-Browser-Use-API-Key": apiKey || "" },
      });
      const status = (await statusResponse.json().catch(() => ({}))) as TaskStatus;
      if (!statusResponse.ok) return undefined;
      if (status.status === "finished") return cleanResult(parseOutput(status.output));
      if (status.status === "failed" || status.status === "stopped") return undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
