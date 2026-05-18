"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Phone, RefreshCw, Send, Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/AppShell";
import { compactDate } from "@/lib/format";
import type { buildAgentRunState } from "@/lib/agentRunState";

type AgentRunState = ReturnType<typeof buildAgentRunState>;

function StageIcon({ state }: { state: string }) {
  if (state === "done") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-300 text-slate-950">
        <Check size={16} />
      </span>
    );
  }
  if (state === "working" || state === "ready") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-300 text-slate-950">
        <Loader2 className="animate-spin" size={16} />
      </span>
    );
  }
  return <span className="h-7 w-7 rounded-full border border-white/15 bg-white/5" />;
}

function activityIcon(title: string) {
  if (title.includes("Outreach")) return <Send size={16} />;
  if (title.includes("replied") || title.includes("responded")) return <Phone size={16} />;
  return <Sparkles size={16} />;
}

export function AgentRunClient({ initialState }: { initialState: AgentRunState }) {
  const [state, setState] = useState(initialState);
  const [lastWake, setLastWake] = useState("");
  const [error, setError] = useState("");
  const runningRef = useRef(false);
  const stateRef = useRef(initialState);

  const applyState = useCallback((next: AgentRunState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      const response = await fetch(`/api/campaigns/${initialState.campaignId}/agent-state`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not refresh broker state");
      return (await response.json()) as AgentRunState;
    }

    async function wakeBroker() {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const response = await fetch(`/api/campaigns/${initialState.campaignId}/agent-work`, { method: "POST" });
        if (!response.ok) throw new Error("Broker wake failed");
        const next = (await response.json()) as AgentRunState;
        if (!stopped) {
          applyState(next);
          setLastWake(new Date().toISOString());
          setError("");
        }
      } catch (workError) {
        try {
          const next = await refresh();
          if (!stopped) applyState(next);
        } catch {
          if (!stopped) setError(workError instanceof Error ? workError.message : "Broker wake failed");
        }
      } finally {
        runningRef.current = false;
      }
    }

    async function loop() {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        const latest = await refresh().catch(() => stateRef.current);
        if (!stopped) applyState(latest);
        if (!latest.terminal) await wakeBroker();
      }
      if (!stopped) timer = setTimeout(loop, stateRef.current.terminal ? 15_000 : 30_000);
    }

    timer = setTimeout(loop, 2_000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [applyState, initialState.campaignId]);

  const waiting = !state.terminal;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-140px)] max-w-4xl flex-col justify-center py-8">
      <section className="border-b border-white/10 pb-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-medium text-cyan-200">{state.domain}</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight text-white md:text-5xl">
              {state.headline}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">{state.subheadline}</p>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
            {waiting ? <Loader2 className="animate-spin text-cyan-200" size={18} /> : <Check className="text-emerald-300" size={18} />}
            {waiting ? "Working" : "Response reached"}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border border-white/10 bg-slate-900 px-4 py-3">
            <p className="text-xs text-slate-500">Buyers found</p>
            <p className="mt-1 text-2xl font-semibold text-white">{state.counts.buyersFound}</p>
          </div>
          <div className="rounded-md border border-white/10 bg-slate-900 px-4 py-3">
            <p className="text-xs text-slate-500">Emails sent</p>
            <p className="mt-1 text-2xl font-semibold text-white">{state.counts.sent}</p>
          </div>
          <div className="rounded-md border border-white/10 bg-slate-900 px-4 py-3">
            <p className="text-xs text-slate-500">Replies</p>
            <p className="mt-1 text-2xl font-semibold text-white">{state.counts.replies}</p>
          </div>
          <div className="rounded-md border border-white/10 bg-slate-900 px-4 py-3">
            <p className="text-xs text-slate-500">Deposits paid</p>
            <p className="mt-1 text-2xl font-semibold text-white">{state.counts.depositsPaid}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Live Agent Loop</h2>
            <StatusBadge>{state.stage.replaceAll("_", " ")}</StatusBadge>
          </div>
          <div className="grid gap-4">
            {state.milestones.map((step) => (
              <div key={step.label} className="flex gap-4 rounded-md border border-white/10 bg-slate-900 p-4">
                <StageIcon state={step.state} />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-white">{step.label}</p>
                    <StatusBadge>{step.state}</StatusBadge>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {state.latestReply ? (
            <div className="mt-6 rounded-md border border-emerald-300/30 bg-emerald-300/10 p-4">
              <p className="text-sm font-semibold text-emerald-100">Latest buyer reply</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-100">{state.latestReply.body}</p>
            </div>
          ) : null}
        </div>

        <aside>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">What It Did</h2>
            <RefreshCw className={waiting ? "animate-spin text-cyan-200" : "text-emerald-300"} size={18} />
          </div>
          <div className="grid gap-3">
            {error ? <p className="rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</p> : null}
            {lastWake ? <p className="text-xs text-slate-500">Last wake: {compactDate(lastWake)}</p> : null}
            {state.activities.map((item) => (
              <div key={item.id} className="rounded-md border border-white/10 bg-slate-900 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <span className="text-cyan-200">{activityIcon(item.title)}</span>
                  {item.title}
                </div>
                <p className="mt-1 line-clamp-4 text-xs leading-5 text-slate-400">{item.detail}</p>
                <p className="mt-2 text-[11px] text-slate-600">{compactDate(item.at)}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
