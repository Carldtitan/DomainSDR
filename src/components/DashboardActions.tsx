"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Inbox, Loader2 } from "lucide-react";
import { secondaryButtonClass } from "@/components/AppShell";

export function DashboardActions() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function poll() {
    setPending(true);
    const response = await fetch("/api/replies/poll", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    setPending(false);
    setMessage(`${data.events?.length || 0} new repl${data.events?.length === 1 ? "y" : "ies"} processed.`);
    router.refresh();
  }

  async function tick() {
    setPending(true);
    const response = await fetch("/api/agent/tick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sendFollowUps: true,
        minHoursSinceLastSend: 0,
        maxFollowUpsPerTick: 3,
      }),
    });
    const data = await response.json().catch(() => ({}));
    setPending(false);
    setMessage(
      `${data.processedReplies?.length || 0} replies processed, ${data.sentFollowUps?.length || 0} follow-up(s) sent, ${data.followUps?.length || 0} due.`,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button className={secondaryButtonClass} disabled={pending} onClick={poll}>
        {pending ? <Loader2 className="animate-spin" size={16} /> : <Inbox size={16} />}
        Poll AgentMail
      </button>
      <button className={secondaryButtonClass} disabled={pending} onClick={tick}>
        {pending ? <Loader2 className="animate-spin" size={16} /> : <Bot size={16} />}
        Run Agent Work Loop
      </button>
      {message ? <span className="text-sm text-slate-400">{message}</span> : null}
    </div>
  );
}
