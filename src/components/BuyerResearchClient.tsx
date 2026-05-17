"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, MailPlus, Search } from "lucide-react";
import {
  buttonClass,
  Panel,
  secondaryButtonClass,
  StatusBadge,
} from "@/components/AppShell";
import type { FullCampaign } from "@/lib/types";

export function BuyerResearchClient({ full }: { full: FullCampaign }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function call(path: string, payload?: unknown, next?: string) {
    setPending(path);
    setError("");
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    setPending(null);
    if (!response.ok) {
      setError(data.error || "Action failed");
      return;
    }
    router.refresh();
    if (next) router.push(next);
  }

  return (
    <div className="grid gap-6">
      <Panel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Buyer Research</h1>
            <p className="mt-1 text-sm font-medium text-cyan-100">{full.campaign.domain}</p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              {full.campaign.analysis?.positioning_statement || full.campaign.use_case_thesis}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={buttonClass}
              disabled={Boolean(pending)}
              onClick={() => call(`/api/campaigns/${full.campaign.id}/buyers`)}
            >
              {pending?.includes("/buyers") ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
              Find Buyers
            </button>
            <button
              className={secondaryButtonClass}
              disabled={Boolean(pending) || full.leads.length === 0}
              onClick={() =>
                call(`/api/campaigns/${full.campaign.id}/messages/generate`, { top: 5 }, `/campaign/${full.campaign.id}/outreach`)
              }
            >
              {pending?.includes("/messages") ? <Loader2 className="animate-spin" size={16} /> : <MailPlus size={16} />}
              Generate Top 5
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            ["1", "Find public buyers"],
            ["2", "Score fit and contactability"],
            ["3", "Draft reviewed emails"],
          ].map(([step, label]) => (
            <div key={step} className="rounded-md border border-white/10 bg-slate-950 p-3">
              <span className="text-xs font-semibold text-cyan-200">Step {step}</span>
              <p className="mt-1 text-sm text-slate-200">{label}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Use Cases</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(full.campaign.analysis?.likely_use_cases || []).map((item) => (
                <StatusBadge key={item}>{item}</StatusBadge>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Buyer Categories</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(full.campaign.analysis?.buyer_categories || []).map((item) => (
                <StatusBadge key={item}>{item}</StatusBadge>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Risk Guardrails</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(full.campaign.analysis?.risks || []).slice(0, 3).map((item) => (
                <StatusBadge key={item}>{item}</StatusBadge>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {error ? <p className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

      <Panel>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Ranked Leads</h2>
          <StatusBadge>{full.leads.length} leads</StatusBadge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="border-b border-white/10 py-3 pr-4">Company</th>
                <th className="border-b border-white/10 py-3 pr-4">Website</th>
                <th className="border-b border-white/10 py-3 pr-4">Score</th>
                <th className="border-b border-white/10 py-3 pr-4">Reason Fit</th>
                <th className="border-b border-white/10 py-3 pr-4">Weakness</th>
                <th className="border-b border-white/10 py-3 pr-4">Contact</th>
                <th className="border-b border-white/10 py-3 pr-4">Status</th>
                <th className="border-b border-white/10 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {full.leads.map((lead) => (
                <tr key={lead.id} className="align-top">
                  <td className="border-b border-white/5 py-4 pr-4 font-medium text-white">{lead.company_name}</td>
                  <td className="border-b border-white/5 py-4 pr-4 text-cyan-200">
                    <a href={lead.website} target="_blank" rel="noreferrer">
                      {lead.current_domain || lead.website}
                    </a>
                  </td>
                  <td className="border-b border-white/5 py-4 pr-4">
                    <span className="rounded-md bg-emerald-300 px-2 py-1 font-semibold text-slate-950">{lead.fit_score}</span>
                  </td>
                  <td className="max-w-md border-b border-white/5 py-4 pr-4 text-slate-300">{lead.reason_fit}</td>
                  <td className="max-w-xs border-b border-white/5 py-4 pr-4 text-slate-400">{lead.current_domain_weakness}</td>
                  <td className="border-b border-white/5 py-4 pr-4 text-slate-300">
                    <span className="block">
                      {lead.contact_email || (
                        <a href={lead.contact_url} target="_blank" rel="noreferrer" className="text-cyan-200">
                          Contact page
                        </a>
                      )}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">{lead.contact_phone || "No public phone"}</span>
                  </td>
                  <td className="border-b border-white/5 py-4 pr-4">
                    <StatusBadge>{lead.status.replaceAll("_", " ")}</StatusBadge>
                  </td>
                  <td className="border-b border-white/5 py-4">
                    <div className="flex gap-2">
                      <button
                        className={secondaryButtonClass}
                        disabled={Boolean(pending)}
                        onClick={() => call(`/api/campaigns/${full.campaign.id}/messages/generate`, { leadId: lead.id })}
                      >
                        Email
                      </button>
                      <Link className={secondaryButtonClass} href={`/campaign/${full.campaign.id}/conversation/${lead.id}`}>
                        Thread
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {full.leads.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    No leads yet. Click Find Buyers or wake the broker; it will search, score, and enrich buyers.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
