import Link from "next/link";
import { Bot, ShieldCheck } from "lucide-react";
import type { DomainCampaign } from "@/lib/types";
import { money } from "@/lib/format";

type AppShellProps = {
  campaign?: DomainCampaign;
  children: React.ReactNode;
};

export function AppShell({ campaign, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-white/10 bg-slate-950/95">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Link href="/" className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-cyan-400 text-slate-950">
                <ShieldCheck size={20} />
              </span>
              <span>
                <span className="block text-lg font-semibold tracking-normal">DomainSDR</span>
                <span className="block text-xs text-slate-400">Broker agent for owned domains</span>
              </span>
            </Link>

            {campaign ? (
              <div className="grid gap-1 text-sm text-slate-300 sm:grid-cols-3 sm:gap-4">
                <span>
                  Domain <strong className="text-white">{campaign.domain}</strong>
                </span>
                <span>
                  Ask <strong className="text-white">{money(campaign.ask_price)}</strong>
                </span>
                <span>
                  Status <strong className="text-white">{campaign.status.replaceAll("_", " ")}</strong>
                </span>
              </div>
            ) : null}
          </div>

          <div className="inline-flex w-fit items-center gap-2 rounded-md border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-medium text-emerald-100">
            <Bot size={14} />
            The broker keeps working until a buyer replies or a deposit is paid
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

export function StatusBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-medium text-slate-200">
      {children}
    </span>
  );
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-md border border-white/10 bg-slate-900 p-5 ${className}`}>{children}</section>;
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-sm font-medium text-slate-200">{children}</label>;
}

export const inputClass =
  "mt-2 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300";

export const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-md bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60";
