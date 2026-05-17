"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Inbox, Loader2 } from "lucide-react";
import { secondaryButtonClass } from "@/components/AppShell";

export function DashboardActions({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function poll() {
    setPending(true);
    const response = await fetch("/api/replies/poll", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    setPending(false);
    setMessage(
      `${data.processedReplies?.length || 0} repl${data.processedReplies?.length === 1 ? "y" : "ies"} processed, ${data.agentResponses?.length || 0} response(s) sent, ${data.draftedOutreach?.length || 0} draft(s) prepared.`,
    );
    router.refresh();
  }

  async function tick() {
    setPending(true);
    const response = await fetch("/api/agent/tick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        sendFollowUps: true,
        sendNegotiationReplies: true,
        sendFirstTouch: true,
        discoverBuyers: true,
        minHoursSinceLastSend: 0,
        maxFollowUpsPerTick: 3,
        maxFirstTouchSendsPerTick: 2,
      }),
    });
    const data = await response.json().catch(() => ({}));
    setPending(false);
    setMessage(
      `${data.researchedCampaigns?.length || 0} research run(s), ${data.sentFirstTouch?.length || 0} first-touch email(s), ${data.processedReplies?.length || 0} replies, ${data.agentResponses?.length || 0} negotiation response(s), ${data.sentFollowUps?.length || 0} follow-up(s).`,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button className={secondaryButtonClass} disabled={pending} onClick={poll}>
        {pending ? <Loader2 className="animate-spin" size={16} /> : <Inbox size={16} />}
        Sync Replies
      </button>
      <button className={secondaryButtonClass} disabled={pending} onClick={tick}>
        {pending ? <Loader2 className="animate-spin" size={16} /> : <Bot size={16} />}
        Wake Broker
      </button>
      {message ? <span className="text-sm text-slate-400">{message}</span> : null}
    </div>
  );
}
