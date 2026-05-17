"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CreditCard, Loader2, Send, ShieldX } from "lucide-react";
import {
  buttonClass,
  FieldLabel,
  inputClass,
  Panel,
  secondaryButtonClass,
  StatusBadge,
} from "@/components/AppShell";
import type { BuyerLead, ConversationEvent, DomainCampaign, Offer } from "@/lib/types";
import { compactDate, money } from "@/lib/format";
import type { OwnershipProof } from "@/lib/ownershipProof";

export function ConversationClient({
  campaign,
  lead,
  events,
  offers,
  ownershipProof,
}: {
  campaign: DomainCampaign;
  lead: BuyerLead;
  events: ConversationEvent[];
  offers: Offer[];
  ownershipProof: OwnershipProof;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const latestInbound = useMemo(
    () => [...events].reverse().find((event) => event.direction === "inbound" && Boolean(event.suggested_response)),
    [events],
  );
  async function post(path: string, payload?: unknown) {
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
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid gap-4">
        <Panel>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-white">{lead.company_name}</h1>
              <p className="mt-1 text-sm text-slate-400">{lead.reason_fit}</p>
            </div>
            <StatusBadge>{lead.status.replaceAll("_", " ")}</StatusBadge>
          </div>
        </Panel>

        <Panel>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Thread</h2>
          </div>

          <div className="grid gap-3">
            {events.map((event) => (
              <div
                key={event.id}
                className={`rounded-md border p-4 ${
                  event.direction === "outbound"
                    ? "border-cyan-300/30 bg-cyan-300/10"
                    : "border-white/10 bg-slate-950"
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <StatusBadge>{event.direction}</StatusBadge>
                  <StatusBadge>{event.classification.replaceAll("_", " ")}</StatusBadge>
                  {event.offer_amount ? <StatusBadge>{money(event.offer_amount)}</StatusBadge> : null}
                  <span>{compactDate(event.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-100">{event.body}</p>
                {event.next_action ? <p className="mt-3 text-sm text-amber-200">Next: {event.next_action}</p> : null}
              </div>
            ))}
            {events.length === 0 ? <p className="text-sm text-slate-400">No conversation events yet.</p> : null}
          </div>
        </Panel>
      </div>

      <ConversationSidebar
        key={latestInbound?.id || "empty"}
        campaign={campaign}
        lead={lead}
        latestInbound={latestInbound}
        offers={offers}
        pending={pending}
        error={error}
        post={post}
        ownershipProof={ownershipProof}
      />
    </div>
  );
}

function ConversationSidebar({
  campaign,
  lead,
  latestInbound,
  offers,
  pending,
  error,
  post,
  ownershipProof,
}: {
  campaign: DomainCampaign;
  lead: BuyerLead;
  latestInbound?: ConversationEvent;
  offers: Offer[];
  pending: string | null;
  error: string;
  post: (path: string, payload?: unknown) => Promise<void>;
  ownershipProof: OwnershipProof;
}) {
  const [responseBody, setResponseBody] = useState(latestInbound?.suggested_response || "");
  const [depositAmount, setDepositAmount] = useState(String(latestInbound?.offer_amount || campaign.ask_price));

  return (
    <aside className="grid gap-4 self-start">
      <Panel>
        <h2 className="text-lg font-semibold text-white">Suggested Response</h2>
        <div className="mt-4">
          <FieldLabel>Agent draft</FieldLabel>
          <textarea
            className={`${inputClass} min-h-56 resize-y`}
            value={responseBody}
            onChange={(event) => setResponseBody(event.target.value)}
            placeholder="Simulate or poll a reply to generate a response."
          />
        </div>
        {error ? <p className="mt-3 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        <button
          className={`${buttonClass} mt-4 w-full`}
          disabled={!latestInbound || !responseBody || Boolean(pending)}
          onClick={() => latestInbound && post(`/api/conversations/${latestInbound.id}/send`, { body: responseBody })}
        >
          {pending?.includes("/api/conversations") ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
          Send Response
        </button>
      </Panel>

      <Panel>
        <h2 className="text-lg font-semibold text-white">Negotiation Controls</h2>
        <div className="mt-4">
          <FieldLabel>Accepted amount</FieldLabel>
          <input
            className={inputClass}
            type="number"
            min={campaign.floor_price}
            value={depositAmount}
            onChange={(event) => setDepositAmount(event.target.value)}
          />
          <p className="mt-2 text-xs text-slate-500">Floor is enforced server-side and hidden from buyers.</p>
        </div>
        <div className="mt-4 grid gap-2">
          <button
            className={buttonClass}
            disabled={Boolean(pending)}
            onClick={() =>
              post("/api/offers/deposit", {
                campaignId: campaign.id,
                leadId: lead.id,
                amount: Number(depositAmount),
                eventId: latestInbound?.id,
                send: true,
              })
            }
          >
            {pending === "/api/offers/deposit" ? <Loader2 className="animate-spin" size={16} /> : <CreditCard size={16} />}
            Request Deposit
          </button>
          <button className={secondaryButtonClass} disabled={Boolean(pending)} onClick={() => post(`/api/leads/${lead.id}/opt-out`)}>
            <ShieldX size={16} />
            Mark Opt-Out
          </button>
          <button className={secondaryButtonClass} disabled={Boolean(pending)} onClick={() => post(`/api/leads/${lead.id}/escalate`)}>
            <AlertTriangle size={16} />
            Escalate
          </button>
        </div>
      </Panel>

      <Panel>
        <h2 className="text-lg font-semibold text-white">Ownership Proof</h2>
        <div className="mt-4 grid gap-3 text-sm">
          <div className="rounded-md border border-white/10 bg-slate-950 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">TXT Record</p>
            <p className="mt-2 break-all text-slate-200">{ownershipProof.txt_record_name}</p>
            <p className="mt-1 break-all font-mono text-cyan-200">{ownershipProof.txt_record_value}</p>
          </div>
          <div className="rounded-md border border-white/10 bg-slate-950 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Landing Page</p>
            <p className="mt-2 break-all text-cyan-200">{ownershipProof.landing_page_path}</p>
            <p className="mt-2 text-slate-300">{ownershipProof.landing_page_text}</p>
          </div>
          <div className="rounded-md border border-white/10 bg-slate-950 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Escrow Route</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-300">
              {ownershipProof.escrow_route.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </div>
      </Panel>

      <Panel>
        <h2 className="text-lg font-semibold text-white">Offers</h2>
        <div className="mt-3 grid gap-3">
          {offers.map((offer) => (
            <a
              key={offer.id}
              href={offer.payment_link}
              className="rounded-md border border-white/10 bg-slate-950 p-3 text-sm transition hover:border-cyan-300/70"
            >
              <span className="block font-medium text-white">{money(offer.amount)}</span>
              <span className="block text-slate-400">{offer.status.replaceAll("_", " ")}</span>
            </a>
          ))}
          {offers.length === 0 ? <p className="text-sm text-slate-400">No offers yet.</p> : null}
        </div>
      </Panel>
    </aside>
  );
}
