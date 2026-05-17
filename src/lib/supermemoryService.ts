type MemoryPayload = {
  campaignId: string;
  type: string;
  content: string;
  metadata?: Record<string, string | number | boolean | string[]>;
};

export async function saveToSupermemory(payload: MemoryPayload) {
  const apiKey = process.env.SUPERMEMORY_API_KEY;
  if (!apiKey) {
    return { ok: false, skipped: true, reason: "SUPERMEMORY_API_KEY not configured" };
  }

  const containerTag =
    process.env.SUPERMEMORY_PROJECT_ID ||
    process.env.SUPERMEMORY_USER_ID ||
    `domainsdr_${payload.campaignId}`;

  try {
    const response = await fetch("https://api.supermemory.ai/v3/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: payload.content,
        containerTag,
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
