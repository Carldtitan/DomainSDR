import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, Panel, StatusBadge } from "@/components/AppShell";
import { DashboardActions } from "@/components/DashboardActions";
import { campaignStats, getFullCampaign } from "@/lib/campaignStore";
import { compactDate, money, truncate } from "@/lib/format";

export const dynamic = "force-dynamic";

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Panel>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
    </Panel>
  );
}

function agentRecommendation(full: NonNullable<Awaited<ReturnType<typeof getFullCampaign>>>) {
  const sent = full.messages.filter((message) => message.status === "sent").length;
  const replies = full.events.filter((event) => event.direction === "inbound").length;
  const bestOffer = full.offers.reduce((max, offer) => Math.max(max, offer.amount), 0);

  if (full.leads.length === 0) {
    return "Run buyer discovery. If no buyers appear, re-angle the domain thesis before changing price.";
  }
  if (sent === 0) return "Generate and send a small reviewed batch to the highest-fit buyers.";
  if (sent >= 5 && replies === 0) return "Pause more sending. Rework the angle or reduce ask before another batch.";
  if (bestOffer >= full.campaign.floor_price) return "Escalate the offer and request deposit or escrow next steps.";
  if (replies > 0) return "Keep the agent watching replies and negotiating inside seller rules.";
  return "Let the agent work loop handle reply polling and one guarded follow-up.";
}

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const full = await getFullCampaign(id);
  if (!full) notFound();
  const stats = await campaignStats(id);

  return (
    <AppShell campaign={full.campaign} active="dashboard">
      <div className="grid gap-6">
        <Panel>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-white">Campaign Dashboard</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                {full.campaign.analysis?.positioning_statement || full.campaign.use_case_thesis}
              </p>
              <p className="mt-3 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-50">
                Agent recommendation: {agentRecommendation(full)}
              </p>
            </div>
            <DashboardActions />
          </div>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Domain" value={full.campaign.domain} />
          <Metric label="Ask Price" value={money(full.campaign.ask_price)} />
          <Panel>
            <p className="text-xs uppercase tracking-wide text-slate-500">Floor Price</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-slate-300">Hidden by default</summary>
              <p className="mt-2 text-3xl font-semibold text-white">{money(full.campaign.floor_price)}</p>
            </details>
          </Panel>
          <Metric label="Deposit" value={money(full.campaign.deposit_amount)} />
          <Metric label="Leads Found" value={stats?.leadsFound ?? 0} />
          <Metric label="Emails Sent" value={stats?.emailsSent ?? 0} />
          <Metric label="Replies" value={stats?.repliesReceived ?? 0} />
          <Metric label="Offers" value={stats?.offersCaptured ?? 0} />
          <Metric label="Deposits Requested" value={stats?.depositsRequested ?? 0} />
          <Metric label="Deposits Paid" value={stats?.depositsPaid ?? 0} />
        </div>

        <Panel>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Pipeline</h2>
            <StatusBadge>{full.leads.length} buyers</StatusBadge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="border-b border-white/10 py-3 pr-4">Buyer</th>
                  <th className="border-b border-white/10 py-3 pr-4">Fit</th>
                  <th className="border-b border-white/10 py-3 pr-4">Last message</th>
                  <th className="border-b border-white/10 py-3 pr-4">Status</th>
                  <th className="border-b border-white/10 py-3 pr-4">Next action</th>
                  <th className="border-b border-white/10 py-3">Open</th>
                </tr>
              </thead>
              <tbody>
                {full.leads.map((lead) => {
                  const last = [...full.events].reverse().find((event) => event.buyer_lead_id === lead.id);
                  return (
                    <tr key={lead.id} className="align-top">
                      <td className="border-b border-white/5 py-4 pr-4">
                        <span className="block font-medium text-white">{lead.company_name}</span>
                        <span className="block text-xs text-slate-500">{lead.current_domain}</span>
                      </td>
                      <td className="border-b border-white/5 py-4 pr-4">
                        <span className="rounded-md bg-emerald-300 px-2 py-1 font-semibold text-slate-950">{lead.fit_score}</span>
                      </td>
                      <td className="max-w-sm border-b border-white/5 py-4 pr-4 text-slate-300">
                        {last ? (
                          <>
                            <span className="block">{truncate(last.body, 130)}</span>
                            <span className="mt-1 block text-xs text-slate-500">{compactDate(last.created_at)}</span>
                          </>
                        ) : (
                          "No thread yet"
                        )}
                      </td>
                      <td className="border-b border-white/5 py-4 pr-4">
                        <StatusBadge>{lead.status.replaceAll("_", " ")}</StatusBadge>
                      </td>
                      <td className="border-b border-white/5 py-4 pr-4 text-slate-300">{lead.next_action || "Review"}</td>
                      <td className="border-b border-white/5 py-4">
                        <Link
                          className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                          href={`/campaign/${full.campaign.id}/conversation/${lead.id}`}
                        >
                          Thread
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
