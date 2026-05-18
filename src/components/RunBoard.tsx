"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Circle, CircleCheck, Clock, Loader2, Mail, Phone, Search, Square, XCircle } from "lucide-react";
import { Panel, secondaryButtonClass, StatusBadge } from "@/components/AppShell";
import { compactDate, money } from "@/lib/format";
import type { FullCampaign } from "@/lib/types";

function statusFor(full: FullCampaign) {
  const replies = full.events.filter((event) => event.direction === "inbound").length;
  const depositsPaid = full.offers.filter((offer) => offer.status === "deposit_paid").length;
  const sent = full.messages.filter((message) => message.status === "sent").length;

  if (full.campaign.status === "closed") return { label: "Ended", icon: XCircle, tone: "text-slate-500 dark:text-slate-400" };
  if (full.campaign.status === "paused") return { label: "Paused", icon: Square, tone: "text-slate-500 dark:text-slate-400" };
  if (depositsPaid > 0) return { label: "Deposit paid", icon: CircleCheck, tone: "text-emerald-600 dark:text-emerald-300" };
  if (replies > 0) return { label: "Reply received", icon: Mail, tone: "text-blue-600 dark:text-blue-300" };
  if (sent > 0) return { label: "Waiting", icon: Clock, tone: "text-amber-600 dark:text-amber-300" };
  if (full.leads.length > 0) return { label: "Contacting", icon: Phone, tone: "text-slate-700 dark:text-slate-200" };
  if (full.campaign.status === "researching") return { label: "Researching", icon: Search, tone: "text-slate-700 dark:text-slate-200" };
  return { label: "Queued", icon: Circle, tone: "text-slate-500 dark:text-slate-400" };
}

export function RunBoard({ runs }: { runs: FullCampaign[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const active = runs.filter((run) => !["closed", "paused"].includes(run.campaign.status));
  const visible = runs.slice(0, 8);

  async function endRun(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/campaigns/${id}/end`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  async function endAll() {
    setBusy("all");
    try {
      await fetch("/api/campaigns/end-all", { method: "POST" });
      router.refresh();
    } finally {
      setBusy("");
    }
  }

  return (
    <Panel className="h-full overflow-auto">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">Domains</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Active and recent runs.</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge>{active.length}</StatusBadge>
          {active.length > 0 ? (
            <button className={`${secondaryButtonClass} px-3 py-1.5`} disabled={busy !== ""} onClick={endAll} type="button">
              {busy === "all" ? <Loader2 className="animate-spin" size={14} /> : <Square size={14} />}
              End all
            </button>
          ) : (
            <button className={`${secondaryButtonClass} px-3 py-1.5`} disabled type="button">
              <XCircle size={14} />
              All ended
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-2 overflow-hidden">
        {visible.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            No runs yet.
          </div>
        ) : (
          visible.map((full) => {
            const status = statusFor(full);
            const StatusIcon = status.icon;
            const sent = full.messages.filter((message) => message.status === "sent").length;
            const replies = full.events.filter((event) => event.direction === "inbound").length;
            const reachable = full.leads.filter((lead) => lead.contact_email || lead.contact_phone).length;
            const canEnd = !["closed", "paused"].includes(full.campaign.status);
            const runBusy = busy === full.campaign.id;

            return (
              <div
                key={full.campaign.id}
                className="group grid gap-3 rounded-md border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-600 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <Link href={`/campaign/${full.campaign.id}/agent`} className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusIcon className={status.tone} size={16} />
                    <span className="truncate font-medium text-slate-950 dark:text-white">{full.campaign.domain}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{status.label}</span>
                    <span>{money(full.campaign.ask_price)}</span>
                    <span>{compactDate(full.campaign.created_at)}</span>
                  </div>
                </Link>
                <div className="flex items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400 sm:justify-end">
                  <span>{full.leads.length} found</span>
                  <span>{reachable} reachable</span>
                  <span>{sent} sent</span>
                  <span>{replies} replies</span>
                  {canEnd ? (
                    <button
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700 transition hover:border-slate-400 disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                      disabled={busy !== ""}
                      onClick={() => endRun(full.campaign.id)}
                      type="button"
                    >
                      {runBusy ? <Loader2 className="animate-spin" size={13} /> : <Square size={13} />}
                      End
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                      <XCircle size={13} />
                      Ended
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}
