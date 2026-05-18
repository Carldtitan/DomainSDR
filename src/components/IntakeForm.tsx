"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Play } from "lucide-react";
import { buttonClass, FieldLabel, inputClass, Panel } from "@/components/AppShell";

type LaunchStep = "idle" | "creating" | "opening";

function LaunchProgress({ step }: { step: LaunchStep }) {
  if (step === "idle") return null;
  const steps = [
    {
      id: "creating",
      label: "Saving run",
      detail: "Domain and price rules.",
    },
    {
      id: "opening",
      label: "Opening status",
      detail: "Live progress starts next.",
    },
  ];

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-white">
        <Loader2 className="animate-spin" size={16} />
        Starting
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
    <Panel className="h-full overflow-auto">
      <div className="flex h-full flex-col">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950 dark:text-white">New run</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Start with one domain.</p>
          </div>
        </div>

        <form action={submit} className="grid flex-1 content-start gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <FieldLabel>Domain</FieldLabel>
              <input className={inputClass} name="domain" placeholder="example.com" required />
            </div>
            <div>
              <FieldLabel>Owner email</FieldLabel>
              <input className={inputClass} name="owner_email" type="email" placeholder="you@example.com" required />
            </div>
            <div>
              <FieldLabel>Owner name</FieldLabel>
              <input className={inputClass} name="owner_name" placeholder="Carl" required />
            </div>
            <div>
              <FieldLabel>Tone</FieldLabel>
              <select className={inputClass} name="tone" defaultValue="direct">
                <option value="direct">Direct</option>
                <option value="concise">Concise</option>
                <option value="warm">Warm</option>
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <FieldLabel>Ask price</FieldLabel>
              <input className={inputClass} name="ask_price" type="number" min="1" placeholder="1500" required />
            </div>
            <div>
              <FieldLabel>Floor</FieldLabel>
              <input className={inputClass} name="floor_price" type="number" min="1" placeholder="500" required />
            </div>
            <div>
              <FieldLabel>Deposit</FieldLabel>
              <input className={inputClass} name="deposit_amount" type="number" min="1" defaultValue="10" required />
            </div>
          </div>

          <div>
            <FieldLabel>Use case</FieldLabel>
            <textarea className={`${inputClass} min-h-16 resize-none`} name="use_case_thesis" placeholder="Who should buy this domain?" />
          </div>

          <div className="grid gap-2 text-sm text-slate-700 dark:text-slate-200 md:grid-cols-3">
            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <input name="can_negotiate" type="checkbox" defaultChecked className="h-4 w-4 accent-slate-950 dark:accent-white" />
              Negotiate
            </label>
            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <input name="can_offer_payment_plan" type="checkbox" className="h-4 w-4 accent-slate-950 dark:accent-white" />
              Payment plan
            </label>
            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <input name="can_offer_lease_to_own" type="checkbox" className="h-4 w-4 accent-slate-950 dark:accent-white" />
              Lease option
            </label>
          </div>

          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200">{error}</p> : null}
          <LaunchProgress step={launchStep} />

          <button className={buttonClass} disabled={launchStep !== "idle"} type="submit">
            {launchStep !== "idle" ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
            {launchStep !== "idle" ? "Opening status..." : "Start Agent"}
          </button>
        </form>
      </div>
    </Panel>
  );
}
