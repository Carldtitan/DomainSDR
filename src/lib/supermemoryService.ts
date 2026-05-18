type MemoryPayload = {
  campaignId: string;
  type: string;
  content: string;
  metadata?: Record<string, string | number | boolean | string[]>;
  customId?: string;
};

type SearchResult = {
  id: string;
  memory?: string;
  chunk?: string;
  similarity?: number;
  metadata?: Record<string, unknown>;
};

function containerTag(campaignId?: string) {
  return (
    process.env.SUPERMEMORY_PROJECT_ID ||
    process.env.SUPERMEMORY_USER_ID ||
    `domainsdr_${campaignId || "workspace"}`
  );
}

export async function saveToSupermemory(payload: MemoryPayload) {
  const apiKey = process.env.SUPERMEMORY_API_KEY;
  if (!apiKey) {
    return { ok: false, skipped: true, reason: "SUPERMEMORY_API_KEY not configured" };
  }

  try {
    const response = await fetch("https://api.supermemory.ai/v3/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: payload.content,
        containerTag: containerTag(payload.campaignId),
        customId: payload.customId,
        metadata: {
          app: "DomainSDR",
          campaignId: payload.campaignId,
          type: payload.type,
          ...(payload.metadata ?? {}),
        },
      }),
    });

    if (!response.ok) {
      return { ok: false, skipped: false, reason: `Supermemory ${response.status}` };
    }

    return { ok: true, data: await response.json() };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      reason: error instanceof Error ? error.message : "Unknown Supermemory error",
    };
  }
}

export async function searchSupermemoryContext({
  campaignId,
  query,
  limit = 5,
  threshold = 0.35,
}: {
  campaignId?: string;
  query: string;
  limit?: number;
  threshold?: number;
}) {
  const apiKey = process.env.SUPERMEMORY_API_KEY;
  if (!apiKey || !query.trim()) return [];

  try {
    const response = await fetch("https://api.supermemory.ai/v4/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        containerTag: containerTag(campaignId),
        searchMode: "hybrid",
        limit,
        threshold,
        rerank: true,
      }),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { results?: SearchResult[] };
    return (data.results || []).map((result) => result.memory || result.chunk || "").filter(Boolean);
  } catch {
    return [];
  }
}

export async function saveWorkspaceSnapshot(content: string) {
  return saveToSupermemory({
    campaignId: "workspace",
    type: "workspace_snapshot",
    content,
    customId: "domainsdr_workspace_snapshot",
    metadata: { snapshot: true },
  });
}

export async function saveEmailPatternMemory({
  domain,
  companyName,
  pattern,
  exampleEmail,
  sourceUrl,
}: {
  domain: string;
  companyName: string;
  pattern: string;
  exampleEmail: string;
  sourceUrl?: string;
}) {
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
  return saveToSupermemory({
    campaignId: "workspace",
    type: "email_pattern",
    customId: `email_pattern_${normalizedDomain}_${pattern}`.replace(/[^a-z0-9_.-]/gi, "_"),
    content: JSON.stringify(
      {
        domain: normalizedDomain,
        companyName,
        pattern,
        exampleEmail,
        sourceUrl,
        note: "Use this only as a research hint. Do not send to guessed addresses unless verified on a public source.",
      },
      null,
      2,
    ),
    metadata: {
      domain: normalizedDomain,
      companyName,
      pattern,
      exampleEmail,
    },
  });
}

export async function searchEmailPatternMemory(domainOrCompany: string) {
  return searchSupermemoryContext({
    campaignId: "workspace",
    query: `public email format contact pattern for ${domainOrCompany}`,
    limit: 3,
    threshold: 0.25,
  });
}
