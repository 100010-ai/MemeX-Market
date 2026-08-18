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
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить диагностику"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex items-center justify-between gap-3"><div><h1 className="text-base font-semibold">Диагностика MXM</h1><p className="mt-0.5 text-[11px] text-[var(--muted)]">Состояние рынка и синхронизации Telegram на сервере.</p></div><button onClick={() => void load()} disabled={loading} className="header-action"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button></div>
      {error ? <div className="rounded-2xl border border-[#5a3035] bg-[#25191b] px-3 py-3 text-xs text-[#ff9aa4]">{error}</div> : null}
      {!data ? loading ? <div className="mxm-skeleton h-72 rounded-2xl" /> : null : <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Metric icon={<Users size={14} />} label="Игроки" value={data.metrics.profiles} />
          <Metric icon={<Gift size={14} />} label="Подарки" value={data.metrics.giftAssets} />
          <Metric icon={<ShoppingCart size={14} />} label="Лоты" value={data.metrics.activeListings} />
          <Metric icon={<Coins size={14} />} label="Мемкоины" value={data.metrics.activeCoins} />
          <Metric icon={<Activity size={14} />} label="Сделки" value={data.metrics.giftTrades + data.metrics.coinTrades} />
        </div>

        <section className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium"><AlertTriangle size={14} />Целостность источника</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Small label="Доступные подарки" value={data.metrics.tradeableGiftAssets} /><Small label="Нет исходных медиа" value={data.metrics.missingGiftMedia} bad={data.metrics.missingGiftMedia > 0} /><Small label="Сожжённые подарки" value={data.metrics.burnedGiftAssets} /><Small label="Офферы в резерве" value={data.metrics.pendingOffers} /></div>
        </section>

        <section className="mt-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
          <div className="border-b border-[var(--border-soft)] px-3 py-3"><p className="text-xs font-medium">Последние синхронизации подарков</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">Последние 20 запусков · проверено {new Date(data.checkedAt).toLocaleTimeString("ru-RU")}</p></div>
          {data.syncRuns.length ? <div className="divide-y divide-[var(--border-soft)]">{data.syncRuns.map((run) => <div key={run.id} className="p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-medium">{run.user}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{ago(run.startedAt)} · {run.pagesFetched} стр. · {run.uniqueImported}/{run.uniqueReceived} импортировано</p></div><span className={`rounded-xl px-2 py-1 text-[9px] uppercase ${run.status === "succeeded" ? "bg-[#153322] text-[var(--positive)]" : run.status === "failed" ? "bg-[#351a1e] text-[var(--negative)]" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}>{run.status === "succeeded" ? "успешно" : run.status === "failed" ? "ошибка" : "в процессе"}</span></div>{run.errorMessage ? <p className="mt-2 break-words rounded-xl bg-[#25191b] px-2.5 py-2 text-[10px] leading-4 text-[#ff9aa4]">{run.errorMessage}</p> : null}</div>)}</div> : <div className="p-8 text-center text-xs text-[var(--muted)]">Синхронизаций пока не было.</div>}
        </section>
      </>}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) { return <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3"><div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">{icon}{label}</div><p className="mt-2 text-lg font-semibold">{value.toLocaleString()}</p></div>; }
function Small({ label, value, bad }: { label: string; value: number; bad?: boolean }) { return <div className="rounded-2xl bg-[var(--panel-2)] p-2.5"><p className="text-[9px] text-[var(--muted)]">{label}</p><p className={`mt-1 text-sm font-semibold ${bad ? "text-[var(--negative)]" : ""}`}>{value.toLocaleString()}</p></div>; }
