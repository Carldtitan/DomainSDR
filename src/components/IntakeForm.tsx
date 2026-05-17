"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Play } from "lucide-react";
import { buttonClass, FieldLabel, inputClass, Panel, StatusBadge } from "@/components/AppShell";
import type { DomainCampaign } from "@/lib/types";
import { compactDate, money } from "@/lib/format";

export function IntakeForm({ campaigns }: { campaigns: DomainCampaign[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<"campaign" | null>(null);
  const [error, setError] = useState("");

  async function submit(formData: FormData) {
    setPending("campaign");
    setError("");
    const payload = Object.fromEntries(formData.entries());
    const response = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setPending(null);
    if (!response.ok) {
      setError(data.error || "Could not create campaign");
      return;
    }
    router.push(`/campaign/${data.campaign.id}/research`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Panel>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">New Domain Campaign</h1>
            <p className="mt-1 text-sm text-slate-400">Set the domain, price guardrails, and agent permissions.</p>
          </div>
        </div>

        <form action={submit} className="grid gap-5">
          <div className="rounded-md border border-white/10 bg-slate-950 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-white">1. Seller</h2>
                <p className="mt-1 text-sm text-slate-500">Used for signatures, ownership proof, and owner escalation.</p>
              </div>
              <StatusBadge>required</StatusBadge>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <FieldLabel>Domain</FieldLabel>
                <input className={inputClass} name="domain" placeholder="yourdomain.ai" required />
              </div>
              <div>
                <FieldLabel>Owner email</FieldLabel>
                <input className={inputClass} name="owner_email" type="email" placeholder="you@example.com" required />
              </div>
              <div>
                <FieldLabel>Owner name</FieldLabel>
                <input className={inputClass} name="owner_name" placeholder="Domain owner" required />
              </div>
              <div>
                <FieldLabel>Tone</FieldLabel>
                <select className={inputClass} name="tone" defaultValue="concise">
                  <option value="concise">Concise</option>
                  <option value="warm">Warm</option>
                  <option value="direct">Direct</option>
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-slate-950 p-4">
            <div className="mb-4">
              <h2 className="font-semibold text-white">2. Price Rules</h2>
              <p className="mt-1 text-sm text-slate-500">The floor is hidden from buyers and enforced server-side.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <FieldLabel>Ask price</FieldLabel>
                <input className={inputClass} name="ask_price" type="number" min="1" placeholder="1500" required />
              </div>
              <div>
                <FieldLabel>Floor price</FieldLabel>
                <input className={inputClass} name="floor_price" type="number" min="1" placeholder="500" required />
              </div>
              <div>
                <FieldLabel>Deposit amount</FieldLabel>
                <input className={inputClass} name="deposit_amount" type="number" min="1" defaultValue="10" required />
              </div>
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-slate-950 p-4">
            <div className="mb-4">
              <h2 className="font-semibold text-white">3. Agent Permissions</h2>
              <p className="mt-1 text-sm text-slate-500">The broker can research, send a capped first batch, follow up once, and negotiate within these limits.</p>
            </div>
            <div className="grid gap-3 text-sm text-slate-200 md:grid-cols-3">
              <label className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 p-3">
                <input name="can_negotiate" type="checkbox" defaultChecked className="h-4 w-4 accent-cyan-300" />
                Can negotiate
              </label>
              <label className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 p-3">
                <input name="can_offer_payment_plan" type="checkbox" className="h-4 w-4 accent-cyan-300" />
                Payment plan allowed
              </label>
              <label className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 p-3">
                <input name="can_offer_lease_to_own" type="checkbox" className="h-4 w-4 accent-cyan-300" />
                Lease-to-own allowed
              </label>
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-slate-950 p-4">
            <FieldLabel>Use case thesis</FieldLabel>
            <textarea
              className={`${inputClass} min-h-24 resize-y`}
              name="use_case_thesis"
              placeholder="Example: AI phone support and receptionist companies that need a clearer category domain."
            />
          </div>

          {error ? <p className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

          <button className={buttonClass} disabled={Boolean(pending)} type="submit">
            {pending === "campaign" ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
            Start Campaign
          </button>
        </form>
      </Panel>

      <Panel>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Recent Campaigns</h2>
          <StatusBadge>{campaigns.length}</StatusBadge>
        </div>
        <div className="grid gap-3">
          {campaigns.length === 0 ? (
            <p className="text-sm text-slate-400">No campaigns yet.</p>
          ) : (
            campaigns.slice(0, 8).map((campaign) => (
              <Link
                key={campaign.id}
                href={`/campaign/${campaign.id}/dashboard`}
                className="rounded-md border border-white/10 bg-slate-950 p-3 transition hover:border-cyan-300/70"
              >
                <span className="block font-medium text-white">{campaign.domain}</span>
                <span className="mt-1 block text-sm text-slate-400">
                  {money(campaign.ask_price)} ask - {campaign.status.replaceAll("_", " ")}
                </span>
                <span className="mt-1 block text-xs text-slate-500">{compactDate(campaign.created_at)}</span>
              </Link>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
