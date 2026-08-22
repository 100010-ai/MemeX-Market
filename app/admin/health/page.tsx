"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowLeft, CircleAlert, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api";

type HealthPayload = {
  health: "healthy" | "degraded" | "critical";
  services: Record<string, { status: "ok" | "warning"; detail: string; latencyMs: number | null }>;
  counters: { recentErrors24h: number; activeConditionalOrders: number; latestGiftSyncAt: string | null };
  checkedAt: string;
};

const labels: Record<string, string> = {
  supabase: "Supabase / Postgres",
  telegramBot: "Telegram Bot API",
  telegramWebhook: "Telegram webhook",
  tonApi: "TonAPI",
  cron: "Cron / workers",
  giftSync: "Gift sync",
};

export default function AdminHealthPage() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await apiFetch<HealthPayload>("/api/admin/health")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось получить состояние систем"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<HealthPayload>("/api/admin/health")
      .then((result) => { if (!cancelled) setData(result); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось получить состояние систем"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const services = data
    ? (Object.entries(data.services) as Array<[string, HealthPayload["services"][string]]>)
    : [];

  return <main className="control-main admin-main min-h-screen">
    <header className="control-topbar admin-topbar">
      <div className="flex items-center gap-3"><Link href="/admin" className="control-icon" aria-label="Назад"><ArrowLeft size={14}/></Link><div><h1 className="text-[15px] font-semibold">Health Center</h1><p className="mt-0.5 text-[10px] text-[var(--muted)]">Состояние интеграций и фоновых процессов без раскрытия секретов</p></div></div>
      <button onClick={() => void load()} className="control-icon ml-auto" aria-label="Обновить"><RefreshCw size={14} className={loading ? "animate-spin" : ""}/></button>
    </header>
    <section className="p-4 md:p-5">
      {error ? <div className="rounded-[16px] border border-red-400/20 bg-red-400/5 p-4 text-xs text-red-200">{error}</div> : null}
      {data ? <>
        <div className="grid gap-3 md:grid-cols-3">
          <Metric label="Общий статус" value={data.health === "healthy" ? "Healthy" : data.health === "degraded" ? "Degraded" : "Critical"} />
          <Metric label="Ошибок за 24ч" value={String(data.counters.recentErrors24h)} />
          <Metric label="Условных ордеров" value={String(data.counters.activeConditionalOrders)} />
        </div>
        <div className="mt-4 overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)]">
          {services.map(([key, item]) => <div key={key} className="flex items-start gap-3 border-b border-[var(--border-soft)] p-3.5 last:border-b-0">
            <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[9px] ${item.status === "ok" ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>{item.status === "ok" ? <Activity size={13}/> : <CircleAlert size={13}/>}</span>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-xs font-medium">{labels[key] || key}</p>{item.latencyMs != null ? <span className="text-[9px] text-[var(--muted)]">{item.latencyMs} ms</span> : null}</div><p className="mt-1 break-words text-[10px] leading-4 text-[var(--muted)]">{item.detail}</p></div>
            <span className={`text-[9px] uppercase tracking-wide ${item.status === "ok" ? "text-emerald-300" : "text-amber-300"}`}>{item.status}</span>
          </div>)}
        </div>
        <p className="mt-3 text-[9px] text-[var(--muted-2)]">Проверено {new Date(data.checkedAt).toLocaleString("ru-RU")}</p>
      </> : loading ? <div className="mxm-skeleton h-60 rounded-[18px]"/> : null}
    </section>
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[16px] border border-[var(--border)] bg-[var(--panel)] p-3.5"><p className="text-[9px] text-[var(--muted)]">{label}</p><p className="mt-1.5 text-lg font-semibold tracking-[-.03em]">{value}</p></div>;
}
