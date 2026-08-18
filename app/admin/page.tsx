"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, Coins, Gift, RefreshCw, ShoppingCart, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ago } from "@/lib/format";

type Metrics = {
  profiles: number;
  giftAssets: number;
  tradeableGiftAssets: number;
  missingGiftMedia: number;
  burnedGiftAssets: number;
  activeListings: number;
  pendingOffers: number;
  giftTrades: number;
  coinTrades: number;
  activeCoins: number;
};

type SyncRun = {
  id: string;
  telegramId: number;
  user: string;
  status: string;
  pagesFetched: number;
  telegramTotalCount: number | null;
  uniqueReceived: number;
  uniqueImported: number;
  assetsUpdated: number;
  virtualCreated: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type Payload = { metrics: Metrics; syncRuns: SyncRun[]; checkedAt: string };

export default function AdminPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await apiFetch<Payload>("/api/admin/diagnostics")); }
    catch (e) { setError(e instanceof Error ? e.message : "Diagnostics failed"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex items-center justify-between gap-3"><div><h1 className="text-base font-semibold">MXM diagnostics</h1><p className="mt-0.5 text-[11px] text-[var(--muted)]">Server-side market and Telegram sync health.</p></div><button onClick={() => void load()} disabled={loading} className="header-action"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button></div>
      {error ? <div className="rounded-lg border border-[#5a3035] bg-[#25191b] px-3 py-3 text-xs text-[#ff9aa4]">{error}</div> : null}
      {!data ? loading ? <div className="mxm-skeleton h-72 rounded-xl" /> : null : <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Metric icon={<Users size={14} />} label="Players" value={data.metrics.profiles} />
          <Metric icon={<Gift size={14} />} label="Gift assets" value={data.metrics.giftAssets} />
          <Metric icon={<ShoppingCart size={14} />} label="Listings" value={data.metrics.activeListings} />
          <Metric icon={<Coins size={14} />} label="Coins" value={data.metrics.activeCoins} />
          <Metric icon={<Activity size={14} />} label="Trades" value={data.metrics.giftTrades + data.metrics.coinTrades} />
        </div>

        <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium"><AlertTriangle size={14} />Source integrity</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Small label="Tradeable source Gifts" value={data.metrics.tradeableGiftAssets} /><Small label="Missing source media" value={data.metrics.missingGiftMedia} bad={data.metrics.missingGiftMedia > 0} /><Small label="Burned source Gifts" value={data.metrics.burnedGiftAssets} /><Small label="Reserved offers" value={data.metrics.pendingOffers} /></div>
        </section>

        <section className="mt-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <div className="border-b border-[var(--border-soft)] px-3 py-3"><p className="text-xs font-medium">Recent Telegram Gift syncs</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">Last 20 runs · checked {new Date(data.checkedAt).toLocaleTimeString()}</p></div>
          {data.syncRuns.length ? <div className="divide-y divide-[var(--border-soft)]">{data.syncRuns.map((run) => <div key={run.id} className="p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-medium">{run.user}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{ago(run.startedAt)} · {run.pagesFetched} pages · {run.uniqueImported}/{run.uniqueReceived} imported</p></div><span className={`rounded-md px-2 py-1 text-[9px] uppercase ${run.status === "succeeded" ? "bg-[#153322] text-[var(--positive)]" : run.status === "failed" ? "bg-[#351a1e] text-[var(--negative)]" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}>{run.status}</span></div>{run.errorMessage ? <p className="mt-2 break-words rounded-md bg-[#25191b] px-2.5 py-2 text-[10px] leading-4 text-[#ff9aa4]">{run.errorMessage}</p> : null}</div>)}</div> : <div className="p-8 text-center text-xs text-[var(--muted)]">No sync runs yet.</div>}
        </section>
      </>}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) { return <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3"><div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">{icon}{label}</div><p className="mt-2 text-lg font-semibold">{value.toLocaleString()}</p></div>; }
function Small({ label, value, bad }: { label: string; value: number; bad?: boolean }) { return <div className="rounded-lg bg-[var(--panel-2)] p-2.5"><p className="text-[9px] text-[var(--muted)]">{label}</p><p className={`mt-1 text-sm font-semibold ${bad ? "text-[var(--negative)]" : ""}`}>{value.toLocaleString()}</p></div>; }
