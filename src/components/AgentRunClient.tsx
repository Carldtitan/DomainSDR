"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Mail, RefreshCw, Send, Search, Square, XCircle } from "lucide-react";
import { secondaryButtonClass, StatusBadge } from "@/components/AppShell";
import { compactDate } from "@/lib/format";
import type { buildAgentRunState } from "@/lib/agentRunState";

type AgentRunState = ReturnType<typeof buildAgentRunState>;

function StageIcon({ state }: { state: string }) {
  if (state === "done") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white dark:bg-emerald-300 dark:text-slate-950">
        <Check size={16} />
      </span>
    );
  }
  if (state === "working" || state === "ready") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white dark:bg-white dark:text-slate-950">
        <Loader2 className="animate-spin" size={16} />
      </span>
    );
  }
  if (state === "stopped") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <XCircle size={15} />
      </span>
    );
  }
  return <span className="h-7 w-7 shrink-0 rounded-full border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950" />;
}

function activityIcon(title: string) {
  if (title.includes("Email") || title.includes("Response")) return <Send size={16} />;
  if (title.includes("Reply")) return <Mail size={16} />;
  return <Search size={16} />;
}

export function AgentRunClient({ initialState }: { initialState: AgentRunState }) {
  const [state, setState] = useState(initialState);
  const [lastWake, setLastWake] = useState("");
  const [error, setError] = useState("");
  const [wakeStatus, setWakeStatus] = useState<"starting" | "checking" | "working" | "idle">("starting");
  const [ending, setEnding] = useState(false);
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
      if (!response.ok) throw new Error("Could not refresh status");
      return (await response.json()) as AgentRunState;
    }

    async function wakeBroker() {
      if (runningRef.current) return;
      runningRef.current = true;
      setWakeStatus("working");
      try {
        const response = await fetch(`/api/campaigns/${initialState.campaignId}/agent-work`, { method: "POST" });
        if (!response.ok) throw new Error("Agent wake failed");
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
          if (!stopped) setError(workError instanceof Error ? workError.message : "Agent wake failed");
        }
      } finally {
        runningRef.current = false;
        if (!stopped) setWakeStatus("idle");
      }
    }

    async function loop() {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        setWakeStatus("checking");
        const latest = await refresh().catch(() => stateRef.current);
        if (!stopped) applyState(latest);
        if (!latest.terminal) await wakeBroker();
        else if (!stopped) setWakeStatus("idle");
      }
      if (!stopped) timer = setTimeout(loop, stateRef.current.terminal ? 15_000 : 30_000);
    }

    timer = setTimeout(loop, 300);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [applyState, initialState.campaignId]);

  async function endRun() {
    setEnding(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${initialState.campaignId}/end`, { method: "POST" });
      if (!response.ok) throw new Error("Could not end run");
      const latest = await fetch(`/api/campaigns/${initialState.campaignId}/agent-state`, { cache: "no-store" });
      if (latest.ok) applyState((await latest.json()) as AgentRunState);
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : "Could not end run");
    } finally {
      setEnding(false);
    }
  }

  const waiting = !state.terminal;
  const ended = state.stage === "ended";
  const paused = state.stage === "paused";
  const stopped = ended || paused;
  const currentAction =
    ended
      ? "This run is stopped."
      : paused
        ? "This run is paused."
      : wakeStatus === "starting"
      ? "Opening run."
      : wakeStatus === "checking"
        ? "Checking status and replies."
        : wakeStatus === "working"
          ? "Working now: buyers, outreach, replies, follow-up, deposits."
          : waiting
            ? "Waiting for the next wake or reply."
            : "Reply or deposit reached.";

  return (
    <div className="mx-auto flex min-h-[calc(100vh-140px)] w-full max-w-5xl flex-col justify-center py-8">
      <section className="border-b border-slate-200 pb-8 dark:border-slate-800">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{state.domain}</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight text-slate-950 dark:text-white md:text-5xl">
              {state.headline}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-300">{state.subheadline}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            {stopped ? <XCircle className="text-slate-500 dark:text-slate-300" size={18} /> : waiting ? <Loader2 className="animate-spin text-slate-500 dark:text-slate-300" size={18} /> : <Check className="text-emerald-500 dark:text-emerald-300" size={18} />}
            {ended ? "Ended" : paused ? "Paused" : wakeStatus === "working" ? "Agent running now" : waiting ? "Watching" : "Complete"}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {ended ? (
            <button className={`${secondaryButtonClass} px-3 py-2`} disabled type="button">
              <XCircle size={16} />
              Ended
            </button>
          ) : (
            <button className={`${secondaryButtonClass} px-3 py-2`} disabled={ending} onClick={endRun} type="button">
              {ending ? <Loader2 className="animate-spin" size={16} /> : <Square size={16} />}
              End run
            </button>
          )}
        </div>
        <p className="mt-5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
          {currentAction}
        </p>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <p className="text-xs text-slate-500 dark:text-slate-400">Buyers found</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{state.counts.buyersFound}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <p className="text-xs text-slate-500 dark:text-slate-400">Reachable</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{state.counts.reachable}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <p className="text-xs text-slate-500 dark:text-slate-400">Sent</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{state.counts.sent + state.counts.callsStarted}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <p className="text-xs text-slate-500 dark:text-slate-400">Replies</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{state.counts.replies}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Status</h2>
            <StatusBadge>{state.stage.replaceAll("_", " ")}</StatusBadge>
          </div>
          <div className="grid gap-4">
            {state.milestones.map((step) => (
              <div key={step.label} className="flex gap-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <StageIcon state={step.state} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-950 dark:text-white">{step.label}</p>
                    <StatusBadge>{step.state}</StatusBadge>
                  </div>
                  <p className="mt-1 break-words text-sm leading-6 text-slate-600 dark:text-slate-400">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {state.latestReply ? (
            <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-300/30 dark:bg-emerald-300/10">
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-100">Latest buyer reply</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 [overflow-wrap:anywhere] dark:text-slate-100">{state.latestReply.body}</p>
            </div>
          ) : null}
        </div>

        <aside>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">Activity</h2>
            {stopped ? <XCircle className="text-slate-500 dark:text-slate-400" size={18} /> : <RefreshCw className={waiting ? "animate-spin text-slate-500 dark:text-slate-300" : "text-emerald-500 dark:text-emerald-300"} size={18} />}
          </div>
          <div className="grid gap-3">
            {error ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100">{error}</p> : null}
            {lastWake ? <p className="text-xs text-slate-500 dark:text-slate-400">Last wake: {compactDate(lastWake)}</p> : null}
            {state.activities.map((item) => (
              <div key={item.id} className="min-w-0 rounded-md border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-950 dark:text-white">
                  <span className="shrink-0 text-slate-500 dark:text-slate-300">{activityIcon(item.title)}</span>
                  <span className="break-words [overflow-wrap:anywhere]">{item.title}</span>
                </div>
                <p className="mt-1 line-clamp-4 break-words text-xs leading-5 text-slate-600 [overflow-wrap:anywhere] dark:text-slate-400">{item.detail}</p>
                <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-600">{compactDate(item.at)}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
