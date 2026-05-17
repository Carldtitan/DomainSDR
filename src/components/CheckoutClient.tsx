"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2 } from "lucide-react";
import { buttonClass, Panel, StatusBadge } from "@/components/AppShell";
import type { Offer } from "@/lib/types";
import { money } from "@/lib/format";

export function CheckoutClient({ offer, domain }: { offer: Offer; domain: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function pay() {
    setPending(true);
    await fetch(`/api/offers/${offer.id}/pay`, { method: "POST" });
    setPending(false);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-xl py-10">
      <Panel>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">Domain Intent Deposit</h1>
            <p className="mt-2 text-sm text-slate-400">{domain}</p>
          </div>
          <StatusBadge>{offer.status.replaceAll("_", " ")}</StatusBadge>
        </div>
        <div className="mt-8 rounded-md border border-white/10 bg-slate-950 p-4">
          <p className="text-sm text-slate-400">Accepted sale amount</p>
          <p className="mt-1 text-3xl font-semibold text-white">{money(offer.amount)}</p>
          <p className="mt-4 text-sm text-slate-400">
            This MVP checkout records a small intent deposit. Domain transfer should use escrow or a trusted marketplace.
          </p>
        </div>
        <button className={`${buttonClass} mt-6 w-full`} disabled={pending || offer.status === "deposit_paid"} onClick={pay}>
          {pending ? <Loader2 className="animate-spin" size={16} /> : <CreditCard size={16} />}
          {offer.status === "deposit_paid" ? "Deposit Paid" : "Pay Mock Deposit"}
        </button>
      </Panel>
    </div>
  );
}
