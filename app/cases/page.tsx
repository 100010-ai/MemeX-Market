"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Clock3, Gem, PackageOpen, ShieldCheck, Sparkles, Star } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { rarityLabel } from "@/lib/ui-copy";
import { useTelegramProfile } from "@/components/telegram-provider";

type CaseItem = { sku: string; title: string; tier: string; description: string; quantity: number; remaining: number | null; odds: Array<{ reward: string; label: string; percent: number; rarity: string }> };
type HistoryItem = { id: string; caseSku: string; rewardLabel: string; rarity: string; openedAt: string };
type Payload = { cases: CaseItem[]; history: HistoryItem[] };
type OpenResult = { status: string; reward: { label: string; rarity: string; kind: string; amount: number; creditedEnergy?: number | null; overflowMxmCoins?: number | null }; remaining: number };

const TIER_LABEL: Record<string, string> = { starter: "Базовая серия", rare: "Редкая серия", legendary: "Легендарная серия" };
const TIER_CLASS: Record<string, string> = {
  starter: "mxm-case-art-starter",
  rare: "mxm-case-art-rare",
  legendary: "mxm-case-art-legendary",
};
const CASE_ART_CLASS: Record<string, string> = {
  case_starter: "mxm-case-art-starter",
  case_market: "mxm-case-art-market",
  case_rare: "mxm-case-art-rare",
  case_creator: "mxm-case-art-creator",
  case_legendary: "mxm-case-art-legendary",
  case_vault: "mxm-case-art-vault",
};
const RARITY_BAR: Record<string, string> = {
  common: "mxm-odds-common",
  rare: "mxm-odds-rare",
  epic: "mxm-odds-epic",
  legendary: "mxm-odds-legendary",
};

export default function CasesPage() {
  const { haptic } = useTelegramProfile();
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<string>("case_starter");
  const [opening, setOpening] = useState(false);
  const [reward, setReward] = useState<OpenResult["reward"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openingRequestRef = useRef<{ caseSku: string; requestId: string } | null>(null);
  const revealTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const payload = await apiFetch<Payload>("/api/cases", { cacheMs: 20_000 });
    setData(payload);
    setSelected((current) => payload.cases.some((item) => item.sku === current) ? current : payload.cases[0]?.sku || "case_starter");
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить кейсы"));
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (revealTimerRef.current != null) window.clearTimeout(revealTimerRef.current);
    };
  }, [load]);

  const current = data?.cases.find((item) => item.sku === selected) || null;
  const totalOwned = useMemo(() => data?.cases.reduce((sum, item) => sum + item.quantity, 0) || 0, [data?.cases]);
  const bestChance = useMemo(() => current?.odds.reduce((best, item) => {
    const ranks: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };
    return (ranks[item.rarity] || 0) > (ranks[best?.rarity || "common"] || 0) ? item : best;
  }, current?.odds[0]) || null, [current]);

  async function open() {
    if (!current || current.quantity < 1 || opening) return;
    setOpening(true); setReward(null); setError(null); haptic("medium");
    try {
      const attempt = openingRequestRef.current?.caseSku === current.sku
        ? openingRequestRef.current
        : { caseSku: current.sku, requestId: crypto.randomUUID() };
      openingRequestRef.current = attempt;
      const result = await apiFetch<OpenResult>("/api/cases", { method: "POST", body: JSON.stringify(attempt) });
      openingRequestRef.current = null;
      revealTimerRef.current = window.setTimeout(() => {
        setReward(result.reward);
        setOpening(false);
        haptic("heavy");
        void load().catch((cause) => {
          setError(cause instanceof Error ? cause.message : "Награда получена, но список кейсов не обновился");
        });
      }, 720);
    } catch (cause) {
      setOpening(false);
      setError(cause instanceof Error ? cause.message : "Не удалось открыть кейс");
    }
  }

  return <div className="mx-auto max-w-5xl">
    <header className="mb-4 flex items-end justify-between gap-3 border-b border-[var(--border-soft)] pb-4"><div><p className="text-[10px] uppercase tracking-[.14em] text-[var(--muted-2)]">Коллекционные серии</p><h1 className="mt-1 text-[20px] font-semibold tracking-[-.035em]">Кейсы MXM</h1><p className="mt-1.5 max-w-2xl text-[10px] leading-5 text-[var(--muted)]">Шансы раскрыты до открытия, результат выбирается на сервере криптографическим генератором. Дубликаты постоянных предметов автоматически компенсируются MXM.</p></div><Link href="/store?category=cases" className="mxm-quick-link"><Star size={13} fill="currentColor" />Магазин</Link></header>
    {error ? <div className="mxm-alert mxm-alert-error mb-3">{error}</div> : null}
    <div className="mb-3 grid grid-cols-3 gap-2 border-y border-[var(--border-soft)] py-3 text-center"><div><p className="text-[8px] text-[var(--muted)]">В инвентаре</p><p className="mt-1 text-[12px] font-semibold">{totalOwned}</p></div><div><p className="text-[8px] text-[var(--muted)]">Серий</p><p className="mt-1 text-[12px] font-semibold">{data?.cases.length || 0}</p></div><div><p className="text-[8px] text-[var(--muted)]">Открыто ранее</p><p className="mt-1 text-[12px] font-semibold">{data?.history.length || 0}</p></div></div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0">
        <div className="mxm-hscroll gap-2 pb-1">{data?.cases.map((item) => <button key={item.sku} type="button" onClick={() => { setSelected(item.sku); setReward(null); }} className={`mxm-filter-chip ${selected === item.sku ? "is-active" : ""}`}>{item.title}<span className="text-[8px] opacity-60">×{item.quantity}</span></button>)}</div>
        <div className={`mxm-case-stage mt-4 grid min-h-[300px] place-items-center overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--surface)] p-5 text-center ${opening ? "is-opening" : ""}`}>
          {reward ? <div className="mxm-case-reward max-w-sm"><Sparkles size={34} className="mx-auto text-[#f5c451]" /><p className="mt-3 text-[9px] uppercase tracking-[.16em] text-[var(--muted)]">{rarityLabel(reward.rarity)}</p><p className="mt-1 text-lg font-semibold">{reward.label}</p><p className="mt-2 text-[9px] text-[var(--muted)]">Награда уже добавлена в аккаунт</p>{Number(reward.overflowMxmCoins || 0) > 0 ? <p className="mt-2 text-[8px] text-[var(--accent)]">Излишек энергии компенсирован: +{Number(reward.overflowMxmCoins).toLocaleString("ru-RU")} MXM</p> : null}</div> : <div className="max-w-md"><div className={`mxm-case-art ${CASE_ART_CLASS[current?.sku || ""] || TIER_CLASS[current?.tier || "starter"] || TIER_CLASS.starter}`}><Box size={44} /></div><p className="mt-4 text-[8px] uppercase tracking-[.14em] text-[var(--muted-2)]">{TIER_LABEL[current?.tier || "starter"] || "Серия MXM"}</p><h2 className="mt-1 text-base font-semibold">{current?.title || "Загрузка…"}</h2><p className="mx-auto mt-2 max-w-sm text-[10px] leading-5 text-[var(--muted)]">{current?.description}</p><div className="mt-3 flex items-center justify-center gap-3 text-[8px] text-[var(--muted)]"><span>В инвентаре: <b className="font-medium text-white">{current?.quantity || 0}</b></span>{current?.remaining != null ? <span>Осталось в серии: <b className="font-medium text-white">{current.remaining.toLocaleString("ru-RU")}</b></span> : null}</div>{bestChance ? <p className="mt-2 text-[8px] text-[var(--muted-2)]">Максимальная редкость в таблице: {rarityLabel(bestChance.rarity)}</p> : null}</div>}
        </div>
        {current?.quantity ? <button type="button" disabled={opening} onClick={() => void open()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] bg-white py-3 text-[11px] font-semibold text-black disabled:opacity-40"><PackageOpen size={15} />{opening ? "Определяем награду…" : `Открыть 1 кейс · осталось ${current.quantity}`}</button> : <Link href="/store?category=cases" className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] bg-white py-3 text-[11px] font-semibold text-black"><PackageOpen size={15} />Купить кейс в магазине MXM</Link>}
        <p className="mt-2 flex items-center justify-center gap-1 text-[8px] text-[var(--muted-2)]"><ShieldCheck size={9} />Один запрос открытия = одна серверная транзакция; повторный запрос с тем же ID не выдаст награду второй раз.</p>
      </section>
      <aside className="space-y-4">
        <section className="overflow-hidden border-y border-[var(--border-soft)]"><div className="mxm-section-head"><span>Вероятности</span><span>100%</span></div><div className="divide-y divide-[var(--border-soft)]">{current?.odds.map((odd) => <div key={`${odd.reward}:${odd.rarity}`} className="py-2.5"><div className="flex items-center gap-2"><Gem size={11} className="text-[var(--accent)]" /><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-medium">{odd.label}</p><p className="mt-0.5 text-[8px] text-[var(--muted)]">{rarityLabel(odd.rarity)}</p></div><span className="text-[10px]">{odd.percent.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%</span></div><div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[.04]"><div className={`h-full rounded-full ${RARITY_BAR[odd.rarity] || RARITY_BAR.common}`} style={{ width: `${Math.max(1.5, Math.min(100, odd.percent))}%` }} /></div></div>)}</div></section>
        <section className="overflow-hidden border-y border-[var(--border-soft)]"><div className="mxm-section-head"><span>Последние открытия</span><Clock3 size={12} /></div><div className="divide-y divide-[var(--border-soft)]">{data?.history.length ? data.history.slice(0, 10).map((item) => <div key={item.id} className="py-2.5"><p className="truncate text-[10px] font-medium">{item.rewardLabel}</p><p className="mt-1 text-[8px] text-[var(--muted)]">{rarityLabel(item.rarity)} · {new Date(item.openedAt).toLocaleString("ru-RU")}</p></div>) : <p className="py-6 text-center text-[9px] text-[var(--muted)]">История пока пуста</p>}</div></section>
      </aside>
    </div>
  </div>;
}
