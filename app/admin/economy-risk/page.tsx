"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw, ShieldAlert, SlidersHorizontal, TrendingDown, TrendingUp, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { RuntimeConfig, RuntimeFeatureFlags } from "@/lib/runtime-config";

type Metrics = Record<string, number>;
type Daily = { date: string; emission: number; burned: number; net: number };
type Payload = {
  metrics: Metrics;
  daily: Daily[];
  risks: {
    washPairs: Array<{ a: string; b: string; aName: string; bName: string; count: number; volume: number }>;
    topRecipients: Array<{ profileId: string; name: string; amount: number }>;
    errors: Array<{ route: string; error_name: string; message: string; count: number; affected_users: number; first_seen_at: string; last_seen_at: string }>;
  };
  runtime: RuntimeConfig;
  checkedAt: string;
};

const flagLabels: Record<keyof RuntimeFeatureFlags, string> = { gifts: "Gifts trading", memecoins: "Memecoins", referrals: "Referrals", stars: "Telegram Stars" };
const n = (value: unknown) => Number(value || 0);
const fmt = (value: unknown) => n(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export default function EconomyRiskPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<RuntimeConfig | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { const next = await apiFetch<Payload>("/api/admin/economy-risk", { cacheMs: 0 }); setData(next); setDraft(next.runtime); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить Economy & Risk"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    let cancelled = false;
    void apiFetch<Payload>("/api/admin/economy-risk", { cacheMs: 0 })
      .then((result) => { if (!cancelled) { setData(result); setDraft(result.runtime); } })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить Economy & Risk"); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, []);

  const riskCount = useMemo(() => data ? data.risks.washPairs.length + data.risks.errors.filter((row: Payload["risks"]["errors"][number]) => Number(row.count) >= 5).length : 0, [data]);

  async function saveRuntime() {
    if (!draft || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await apiFetch<{ config: RuntimeConfig }>("/api/admin/runtime-config", { method: "POST", body: JSON.stringify(draft) });
      setDraft(result.config); setData((current: Payload | null) => current ? { ...current, runtime: result.config } : current); setNotice("Runtime Config сохранён без redeploy.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить конфигурацию"); }
    finally { setBusy(false); }
  }

  if (!data || !draft) return <main className="control-root p-4 md:p-6"><div className="mx-auto max-w-7xl"><Link href="/admin" className="inline-flex items-center gap-2 text-xs text-[var(--muted)]"><ArrowLeft size={14}/>Админка</Link><div className="mxm-skeleton mt-4 h-72 rounded-[18px]"/>{error?<p className="mt-3 text-xs text-[var(--negative)]">{error}</p>:null}</div></main>;
  const m = data.metrics;
  return <main className="control-root min-h-[100dvh] p-3 md:p-5">
    <div className="mx-auto max-w-7xl">
      <header className="mb-4 flex items-center gap-3"><Link href="/admin" className="control-icon"><ArrowLeft size={14}/></Link><div><h1 className="text-[15px] font-semibold">Economy & Risk Center</h1><p className="mt-0.5 text-[9px] text-[var(--muted)]">{new Date(data.checkedAt).toLocaleString("ru-RU")} · рисков {riskCount}</p></div><button type="button" disabled={busy} onClick={() => void load()} className="control-small ml-auto"><RefreshCw size={12}/>Обновить</button></header>
      {error?<div className="control-alert control-alert-error">{error}</div>:null}{notice?<div className="control-alert control-alert-ok">{notice}</div>:null}

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Card label="Circulating TON" value={fmt(m.circulatingBalance)} icon={<TrendingUp size={13}/>} />
        <Card label="Emission 24h" value={`+${fmt(m.emission24h)}`} icon={<TrendingUp size={13}/>} />
        <Card label="Burned 24h" value={`-${fmt(m.burned24h)}`} icon={<TrendingDown size={13}/>} />
        <Card label="Net 24h" value={fmt(m.net24h)} tone={n(m.net24h)} />
        <Card label="Inflation 24h" value={`${fmt(m.inflation24h)}%`} tone={n(m.inflation24h)} />
        <Card label="Richest 1% share" value={`${fmt(m.richestOnePercentShare)}%`} icon={<Users size={13}/>} />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <section className="control-panel overflow-hidden"><div className="control-section-title">Экономика 7 дней <span>агрегация ledger на сервере</span></div><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-[10px]"><thead className="text-[var(--muted)]"><tr><th className="p-3">Дата</th><th>Emission</th><th>Burned</th><th>Net</th></tr></thead><tbody className="divide-y divide-[var(--border-soft)]">{data.daily.map((row)=><tr key={row.date}><td className="p-3">{row.date}</td><td className="text-[var(--positive)]">+{fmt(row.emission)}</td><td className="text-[var(--negative)]">-{fmt(row.burned)}</td><td className={row.net>=0?"text-[var(--positive)]":"text-[var(--negative)]"}>{fmt(row.net)}</td></tr>)}</tbody></table></div><div className="grid grid-cols-2 border-t border-[var(--border-soft)]"><Mini label="Referrals 24h" value={fmt(m.referrals24h)}/><Mini label="Coin fees 24h" value={fmt(m.coinFees24h)}/></div></section>

          <section className="control-panel overflow-hidden"><div className="control-section-title"><span className="!text-[11px] !font-semibold !text-white">Risk signals</span><ShieldAlert size={14}/></div>
            <RiskGroup title="Повторяющиеся Gift-пары" empty="Подозрительных пар за 24ч не найдено.">{data.risks.washPairs.map((row)=><div key={`${row.a}:${row.b}`} className="flex items-center justify-between gap-3 py-2.5 text-[10px]"><span className="min-w-0 truncate">{row.aName} ↔ {row.bName}</span><span className="shrink-0 text-[var(--muted)]">{row.count} сделок · {fmt(row.volume)} TON</span></div>)}</RiskGroup>
            <RiskGroup title="Крупнейшие начисления 24ч" empty="Начислений нет.">{data.risks.topRecipients.map((row)=><div key={row.profileId} className="flex items-center justify-between gap-3 py-2.5 text-[10px]"><Link href={`/u/${row.profileId}`} className="truncate">{row.name}</Link><span>+{fmt(row.amount)} TON</span></div>)}</RiskGroup>
            <RiskGroup title="Error Inbox" empty="Ошибок не зарегистрировано.">{data.risks.errors.slice(0,12).map((row)=><div key={`${row.route}:${row.error_name}:${row.message}`} className="py-2.5 text-[10px]"><div className="flex justify-between gap-3"><span className="truncate font-medium">{row.route} · {row.error_name}</span><span className={Number(row.count)>=5?"text-[var(--negative)]":"text-[var(--muted)]"}>×{row.count}</span></div><p className="mt-1 line-clamp-2 text-[9px] text-[var(--muted)]">{row.message}</p></div>)}</RiskGroup>
          </section>
        </div>

        <aside className="control-panel h-fit xl:sticky xl:top-4"><div className="control-section-title"><span className="!text-[11px] !font-semibold !text-white">Runtime Config</span><SlidersHorizontal size={14}/></div><div className="p-3">
          <label className="flex items-center justify-between gap-3 border-b border-[var(--border-soft)] pb-3 text-[10px]"><span><b className="block text-white">Maintenance Mode</b><span className="text-[var(--muted)]">Пользователи видят экран техработ, админка остаётся доступна.</span></span><input type="checkbox" checked={draft.maintenanceMode} onChange={(event)=>setDraft({...draft,maintenanceMode:event.target.checked})}/></label>
          <label className="mt-3 block text-[9px] text-[var(--muted)]">Сообщение<input className="control-input mt-1" value={draft.maintenanceMessage} maxLength={240} onChange={(event)=>setDraft({...draft,maintenanceMessage:event.target.value})}/></label>
          <div className="mt-4"><p className="mb-2 text-[9px] uppercase tracking-[.1em] text-[var(--muted)]">Feature Flags</p>{(Object.keys(flagLabels) as Array<keyof RuntimeFeatureFlags>).map((key)=><label key={key} className="flex items-center justify-between border-b border-[var(--border-soft)] py-2 text-[10px]"><span>{flagLabels[key]}</span><input type="checkbox" checked={draft.featureFlags[key]} onChange={(event)=>setDraft({...draft,featureFlags:{...draft.featureFlags,[key]:event.target.checked}})}/></label>)}</div>
          <div className="mt-4"><p className="mb-2 text-[9px] uppercase tracking-[.1em] text-[var(--muted)]">Remote Limits</p><div className="grid grid-cols-2 gap-2"><Num label="Price alerts" value={draft.remoteConfig.maxPriceAlerts} onChange={(value)=>setDraft({...draft,remoteConfig:{...draft.remoteConfig,maxPriceAlerts:value}})}/><Num label="Watchlist" value={draft.remoteConfig.maxWatchlistItems} onChange={(value)=>setDraft({...draft,remoteConfig:{...draft.remoteConfig,maxWatchlistItems:value}})}/><Num label="Market page" value={draft.remoteConfig.marketPageSize} onChange={(value)=>setDraft({...draft,remoteConfig:{...draft.remoteConfig,marketPageSize:value}})}/><Num label="Open orders" value={draft.remoteConfig.coinOrderMaxOpen} onChange={(value)=>setDraft({...draft,remoteConfig:{...draft.remoteConfig,coinOrderMaxOpen:value}})}/><Num label="Order max days" value={draft.remoteConfig.coinOrderMaxDays} onChange={(value)=>setDraft({...draft,remoteConfig:{...draft.remoteConfig,coinOrderMaxDays:value}})}/></div></div>
          <button type="button" disabled={busy} onClick={()=>void saveRuntime()} className="control-primary mt-4 w-full">Сохранить без redeploy</button>
        </div></aside>
      </div>
    </div>
  </main>;
}
function Card({label,value,icon,tone}:{label:string;value:string;icon?:React.ReactNode;tone?:number}){return <div className="control-panel p-3"><p className="flex items-center gap-1.5 text-[9px] text-[var(--muted)]">{icon}{label}</p><p className={`mt-1 text-sm font-semibold ${tone==null?"":tone>0?"text-[var(--positive)]":tone<0?"text-[var(--negative)]":""}`}>{value}</p></div>}
function Mini({label,value}:{label:string;value:string}){return <div className="p-3"><p className="text-[8px] text-[var(--muted)]">{label}</p><p className="mt-1 text-[11px] font-medium">{value}</p></div>}
function RiskGroup({title,empty,children}:{title:string;empty:string;children:React.ReactNode}){const has=Array.isArray(children)?children.length>0:Boolean(children);return <div className="border-b border-[var(--border-soft)] px-3 py-2 last:border-b-0"><p className="text-[9px] uppercase tracking-[.08em] text-[var(--muted)]">{title}</p>{has?<div className="divide-y divide-[var(--border-soft)]">{children}</div>:<p className="py-3 text-[9px] text-[var(--muted)]">{empty}</p>}</div>}
function Num({label,value,onChange}:{label:string;value:number;onChange:(value:number)=>void}){return <label className="text-[8px] text-[var(--muted)]">{label}<input type="number" className="control-input mt-1" value={value} onChange={(event)=>onChange(Number(event.target.value))}/></label>}
