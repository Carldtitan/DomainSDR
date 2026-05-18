import Link from "next/link";
import { ArrowRight, Circle, CircleCheck, Clock, Mail, Phone, Search } from "lucide-react";
import { Panel, StatusBadge } from "@/components/AppShell";
import { compactDate, money } from "@/lib/format";
import type { FullCampaign } from "@/lib/types";

function statusFor(full: FullCampaign) {
  const replies = full.events.filter((event) => event.direction === "inbound").length;
  const depositsPaid = full.offers.filter((offer) => offer.status === "deposit_paid").length;
  const sent = full.messages.filter((message) => message.status === "sent").length;

  if (depositsPaid > 0) return { label: "Deposit paid", icon: CircleCheck, tone: "text-emerald-600 dark:text-emerald-300" };
  if (replies > 0) return { label: "Reply received", icon: Mail, tone: "text-blue-600 dark:text-blue-300" };
  if (sent > 0) return { label: "Waiting", icon: Clock, tone: "text-amber-600 dark:text-amber-300" };
  if (full.leads.length > 0) return { label: "Contacting", icon: Phone, tone: "text-slate-700 dark:text-slate-200" };
  if (full.campaign.status === "researching") return { label: "Researching", icon: Search, tone: "text-slate-700 dark:text-slate-200" };
  return { label: "Queued", icon: Circle, tone: "text-slate-500 dark:text-slate-400" };
}

export function RunBoard({ runs }: { runs: FullCampaign[] }) {
  const active = runs.filter((run) => !["closed", "paused"].includes(run.campaign.status)).slice(0, 7);

  return (
    <Panel className="h-full overflow-auto">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950 dark:text-white">Domains</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Active and recent runs.</p>
        </div>
        <StatusBadge>{active.length}</StatusBadge>
      </div>

      <div className="grid gap-2 overflow-hidden">
        {active.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            No runs yet.
          </div>
        ) : (
          active.map((full) => {
            const status = statusFor(full);
            const StatusIcon = status.icon;
            const sent = full.messages.filter((message) => message.status === "sent").length;
            const replies = full.events.filter((event) => event.direction === "inbound").length;
            const reachable = full.leads.filter((lead) => lead.contact_email || lead.contact_phone).length;

            return (
              <Link
                key={full.campaign.id}
                href={`/campaign/${full.campaign.id}/agent`}
                className="group grid gap-3 rounded-md border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-slate-600 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusIcon className={status.tone} size={16} />
                    <span className="truncate font-medium text-slate-950 dark:text-white">{full.campaign.domain}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{status.label}</span>
                    <span>{money(full.campaign.ask_price)}</span>
                    <span>{compactDate(full.campaign.created_at)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400 sm:justify-end">
                  <span>{full.leads.length} found</span>
                  <span>{reachable} reachable</span>
                  <span>{sent} sent</span>
                  <span>{replies} replies</span>
                  <ArrowRight className="text-slate-400 transition group-hover:translate-x-0.5" size={16} />
                </div>
              </Link>
            );
          })
        )}
      </div>
    </Panel>
  );
}
