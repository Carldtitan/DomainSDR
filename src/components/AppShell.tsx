import Link from "next/link";
import { Bot, ShieldCheck } from "lucide-react";
import type { DomainCampaign } from "@/lib/types";
import { money } from "@/lib/format";
import { ThemeToggle } from "@/components/ThemeToggle";

type AppShellProps = {
  campaign?: DomainCampaign;
  children: React.ReactNode;
};

export function AppShell({ campaign, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Link href="/" className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-950 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-white">
                <ShieldCheck size={20} />
              </span>
              <span>
                <span className="block text-lg font-semibold tracking-normal text-slate-950 dark:text-white">DomainSDR</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">Broker agent for owned domains</span>
              </span>
            </Link>

            <div className="flex flex-wrap items-center gap-2">
              {campaign ? (
                <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 sm:grid-cols-3">
                  <span className="whitespace-nowrap">
                    Domain <strong className="text-slate-950 dark:text-white">{campaign.domain}</strong>
                  </span>
                  <span className="whitespace-nowrap">
                    Ask <strong className="text-slate-950 dark:text-white">{money(campaign.ask_price)}</strong>
                  </span>
                  <span className="whitespace-nowrap">
                    Status <strong className="text-slate-950 dark:text-white">{campaign.status.replaceAll("_", " ")}</strong>
                  </span>
                </div>
              ) : null}
              <ThemeToggle />
            </div>
          </div>

          <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">
            <Bot size={14} />
            <span className="break-words">The broker keeps working until a buyer replies or a deposit is paid</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

export function StatusBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
      {children}
    </span>
  );
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950 ${className}`}>{children}</section>;
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-sm font-medium text-slate-800 dark:text-slate-200">{children}</label>;
}

export const inputClass =
  "mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-600 dark:focus:border-slate-600 dark:focus:ring-slate-900";

export const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200";

export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:hover:bg-slate-900";
