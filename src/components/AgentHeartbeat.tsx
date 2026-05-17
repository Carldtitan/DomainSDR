"use client";

import { useEffect } from "react";

export function AgentHeartbeat() {
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      if (stopped || document.visibilityState !== "visible") return;
      await fetch("/api/agent/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discoverBuyers: true,
          sendFirstTouch: true,
          sendNegotiationReplies: true,
          sendFollowUps: true,
        }),
      }).catch(() => undefined);
    }

    function schedule(delay = 10_000) {
      timer = setTimeout(async () => {
        await tick();
        if (!stopped) schedule(60_000);
      }, delay);
    }

    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
