export function apifyApiBase() {
  const configured = process.env.APIFY_API_BASE_URL || "https://api.apify.com";
  return configured.replace(/\/+$/, "").replace(/\/v2$/, "");
}

export function apifyToken() {
  return process.env.APIFY_TOKEN || "";
}

export function apifyAllowed() {
  const flag = process.env.ALLOW_APIFY_LIVE_RUN;
  return Boolean(apifyToken()) && flag !== "false" && flag !== "0";
}

export function apifyRunSyncDatasetUrl(actorId: string, timeoutSeconds = 60) {
  const actorPath = actorId.includes("/") ? actorId.replace("/", "~") : actorId;
  return `${apifyApiBase()}/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${encodeURIComponent(
    apifyToken(),
  )}&timeout=${timeoutSeconds}`;
}
