"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Send, Save } from "lucide-react";
import { buttonClass, FieldLabel, inputClass, Panel, secondaryButtonClass, StatusBadge } from "@/components/AppShell";
import type { FullCampaign, OutboundMessage } from "@/lib/types";

type DraftMap = Record<string, { subject: string; body: string; to: string }>;

export function OutreachReviewClient({ full, defaultRecipient }: { full: FullCampaign; defaultRecipient: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [selected, setSelected] = useState(() => new Set(full.messages.filter((m) => m.status !== "sent").map((m) => m.id)));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<DraftMap>(() =>
    Object.fromEntries(
      full.messages.map((message) => [
        message.id,
        {
          subject: message.subject,
          body: message.body,
          to: message.to_email || defaultRecipient,
        },
      ]),
    ),
  );

  const leadById = useMemo(() => new Map(full.leads.map((lead) => [lead.id, lead])), [full.leads]);
  const selectedMessages = useMemo(
    () => full.messages.filter((message) => selected.has(message.id)),
    [full.messages, selected],
  );

  function updateDraft(id: string, patch: Partial<DraftMap[string]>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveMessage(message: OutboundMessage) {
    setPending(`save-${message.id}`);
    setError("");
    const response = await fetch(`/api/messages/${message.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(drafts[message.id]),
    });
    setPending(null);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || "Could not save message");
      return;
    }
    setNotice("Saved");
    router.refresh();
  }

  async function sendSelected() {
    setPending("send");
    setConfirming(false);
    setError("");
    setNotice("");
    const messageIds = Array.from(selected);
    const overrides = Object.fromEntries(messageIds.map((id) => [id, drafts[id]]));
    const response = await fetch("/api/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageIds, overrides }),
    });
    const data = await response.json().catch(() => ({}));
    setPending(null);
    if (!response.ok) {
      setError(data.error || "Could not send messages");
      return;
    }
    const sent = (data.results || []).filter((item: { sent?: { message_id?: string } }) => item.sent?.message_id).length;
    setNotice(`${sent} message(s) queued through AgentMail or controlled send.`);
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <Panel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Draft Queue</h1>
            <p className="mt-1 text-sm text-slate-400">
              Manual override for broker drafts. The broker sends a capped first touch automatically when a lead is qualified and contactable.
            </p>
          </div>
          <button className={buttonClass} disabled={pending === "send" || selected.size === 0} onClick={() => setConfirming(true)}>
            {pending === "send" ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
            Send Selected Now
          </button>
        </div>
        {error ? <p className="mt-4 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        {notice ? <p className="mt-4 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{notice}</p> : null}
      </Panel>

      <div className="grid gap-4">
        {full.messages.map((message) => {
          const lead = leadById.get(message.buyer_lead_id);
          return (
            <Panel key={message.id}>
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-cyan-300"
                    checked={selected.has(message.id)}
                    onChange={() => toggle(message.id)}
                    disabled={message.status === "sent"}
                  />
                  <span>
                    <span className="block font-semibold text-white">{lead?.company_name || "Buyer"}</span>
                    <span className="block text-sm text-slate-400">{lead?.reason_fit}</span>
                  </span>
                </label>
                <div className="flex gap-2">
                  <StatusBadge>{message.status}</StatusBadge>
                  <button className={secondaryButtonClass} disabled={Boolean(pending)} onClick={() => saveMessage(message)}>
                    {pending === `save-${message.id}` ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                    Save
                  </button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
                <div className="grid gap-4">
                  <div>
                    <FieldLabel>Subject</FieldLabel>
                    <input
                      className={inputClass}
                      value={drafts[message.id]?.subject || ""}
                      onChange={(event) => updateDraft(message.id, { subject: event.target.value })}
                    />
                  </div>
                  <div>
                    <FieldLabel>Body</FieldLabel>
                    <textarea
                      className={`${inputClass} min-h-44 resize-y`}
                      value={drafts[message.id]?.body || ""}
                      onChange={(event) => updateDraft(message.id, { body: event.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <FieldLabel>Recipient override</FieldLabel>
                  <input
                    className={inputClass}
                    type="email"
                    aria-readonly="true"
                    readOnly
                    value={drafts[message.id]?.to || ""}
                    onChange={(event) => updateDraft(message.id, { to: event.target.value })}
                  />
                  <p className="mt-3 text-sm text-slate-400">
                    Lead contact: {lead?.contact_email || lead?.contact_url || "none"}
                  </p>
                  <p className="mt-3 text-sm text-slate-500">
                    All outbound email sends are locked to this controlled AgentMail recipient. Sends are capped at five selected messages.
                  </p>
                </div>
              </div>
            </Panel>
          );
        })}
        {full.messages.length === 0 ? (
          <Panel>
            <p className="text-sm text-slate-400">
              No drafts yet. The broker creates drafts automatically after it finds qualified, contactable leads.
            </p>
          </Panel>
        ) : null}
      </div>

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-md border border-amber-300/30 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="mt-1 rounded-md bg-amber-300 p-2 text-slate-950">
                <AlertTriangle size={18} />
              </span>
              <div>
                <h2 className="text-xl font-semibold text-white">Confirm Real Email Send</h2>
                <p className="mt-1 text-sm text-amber-100">
                  This will send a real email to {defaultRecipient}.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              {selectedMessages.map((message) => {
                const lead = leadById.get(message.buyer_lead_id);
                const draft = drafts[message.id];
                return (
                  <div key={message.id} className="rounded-md border border-white/10 bg-slate-950 p-4">
                    <div className="grid gap-2 text-sm">
                      <p>
                        <span className="text-slate-500">Campaign:</span>{" "}
                        <span className="font-medium text-white">{full.campaign.domain}</span>
                      </p>
                      <p>
                        <span className="text-slate-500">Buyer:</span>{" "}
                        <span className="font-medium text-white">{lead?.company_name || "Unknown buyer"}</span>
                      </p>
                      <p>
                        <span className="text-slate-500">Recipient:</span>{" "}
                        <span className="font-medium text-white">{defaultRecipient}</span>
                      </p>
                      <p>
                        <span className="text-slate-500">Subject:</span>{" "}
                        <span className="font-medium text-white">{draft?.subject}</span>
                      </p>
                      <div>
                        <span className="text-slate-500">Body:</span>
                        <p className="mt-2 whitespace-pre-wrap rounded-md border border-white/10 bg-black/30 p-3 text-slate-100">
                          {draft?.body}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button className={secondaryButtonClass} onClick={() => setConfirming(false)} disabled={pending === "send"}>
                Cancel
              </button>
              <button className={buttonClass} onClick={sendSelected} disabled={pending === "send"}>
                {pending === "send" ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                Confirm and Send
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
