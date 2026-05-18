"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Play } from "lucide-react";
import { buttonClass, FieldLabel, inputClass, Panel, StatusBadge } from "@/components/AppShell";

type LaunchStep = "idle" | "creating" | "opening";

function LaunchProgress({ step }: { step: LaunchStep }) {
  if (step === "idle") return null;
  const steps = [
    {
      id: "creating",
      label: "Creating broker workspace",
      detail: "Saving the domain, seller rules, and negotiation limits.",
    },
    {
      id: "opening",
      label: "Opening live agent run",
      detail: "The next screen shows analysis, buyer research, outreach, and reply progress.",
    },
  ];

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-white">
        <Loader2 className="animate-spin" size={16} />
        Starting the agent
      </div>
      <div className="grid gap-3">
        {steps.map((item) => {
          const done = step === "opening" || item.id === step;
          const active = item.id === step;
          return (
            <div key={item.id} className="flex gap-3">
              <span
                className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full ${
                  done
                    ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                    : "border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
                }`}
              >
                {active ? <Loader2 className="animate-spin" size={14} /> : done ? <Check size={14} /> : null}
              </span>
              <span>
                <span className="block text-sm font-medium text-slate-950 dark:text-white">{item.label}</span>
                <span className="block text-xs leading-5 text-slate-500 dark:text-slate-400">{item.detail}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function IntakeForm() {
  const router = useRouter();
  const [launchStep, setLaunchStep] = useState<LaunchStep>("idle");
  const [error, setError] = useState("");

  async function submit(formData: FormData) {
    setLaunchStep("creating");
    setError("");
    const payload = Object.fromEntries(formData.entries());
    const response = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      setLaunchStep("idle");
      setError(data.error || "Could not create campaign");
      return;
    }
    setLaunchStep("opening");
    router.push(`/campaign/${data.campaign.id}/agent`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Panel>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-950 dark:text-white">Launch a domain broker</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Enter the domain and rules once. Then the agent works until a buyer replies or a deposit is paid.
            </p>
          </div>
        </div>

        <form action={submit} className="grid gap-5">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-950 dark:text-white">1. Domain Owner</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Used for signatures, ownership proof, and owner escalation.</p>
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

          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4">
              <h2 className="font-semibold text-slate-950 dark:text-white">2. Price Rules</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">The floor is hidden from buyers and enforced server-side.</p>
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

          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4">
              <h2 className="font-semibold text-slate-950 dark:text-white">3. Broker Permissions</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                The broker starts working immediately. These rules decide how far it can go without owner approval.
              </p>
            </div>
            <div className="grid gap-3 text-sm text-slate-700 dark:text-slate-200 md:grid-cols-3">
              <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <input name="can_negotiate" type="checkbox" defaultChecked className="h-4 w-4 accent-slate-950 dark:accent-white" />
                Can negotiate
              </label>
              <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <input name="can_offer_payment_plan" type="checkbox" className="h-4 w-4 accent-slate-950 dark:accent-white" />
                Payment plan allowed
              </label>
              <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <input name="can_offer_lease_to_own" type="checkbox" className="h-4 w-4 accent-slate-950 dark:accent-white" />
                Lease-to-own allowed
              </label>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
            <FieldLabel>Use case thesis</FieldLabel>
            <textarea
              className={`${inputClass} min-h-24 resize-y`}
              name="use_case_thesis"
              placeholder="Example: AI phone support and receptionist companies that need a clearer category domain."
            />
          </div>

          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200">{error}</p> : null}
          <LaunchProgress step={launchStep} />

          <button className={buttonClass} disabled={launchStep !== "idle"} type="submit">
            {launchStep !== "idle" ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
            {launchStep !== "idle" ? "Opening live progress..." : "Start Agent"}
          </button>
        </form>
      </Panel>
    </div>
  );
}
