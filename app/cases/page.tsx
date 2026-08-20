"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Gem, PackageOpen, Sparkles, Star } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useTelegramProfile } from "@/components/telegram-provider";

type CaseItem = { sku: string; title: string; tier: string; description: string; quantity: number; remaining: number | null; odds: Array<{ reward: string; label: string; percent: number; rarity: string }> };
type HistoryItem = { id: string; caseSku: string; rewardLabel: string; rarity: string; openedAt: string };
type Payload = { cases: CaseItem[]; history: HistoryItem[] };
type OpenResult = { status: string; reward: { label: string; rarity: string; kind: string; amount: number }; remaining: number };

export default function CasesPage() {
  const { haptic } = useTelegramProfile();
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<string>("case_starter");
  const [opening, setOpening] = useState(false);
  const [reward, setReward] = useState<OpenResult["reward"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openingRequestRef = useRef<{ caseSku: string; requestId: string } | null>(null);

  const load = useCallback(async () => {
    const payload = await apiFetch<Payload>("/api/cases", { cacheMs: 0 });
    setData(payload);
    setSelected((current) => payload.cases.some((item) => item.sku === current) ? current : payload.cases[0]?.sku || "case_starter");
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить кейсы"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const current = data?.cases.find((item) => item.sku === selected) || null;
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
      window.setTimeout(() => { setReward(result.reward); setOpening(false); haptic("heavy"); void load(); }, 850);
    } catch (cause) {
      setOpening(false);
      setError(cause instanceof Error ? cause.message : "Не удалось открыть кейс");
    }
  }

  return <div className="mx-auto max-w-5xl">
    <header className="mb-4 flex items-end justify-between gap-3 border-b border-[var(--border-soft)] pb-4"><div><p className="text-[10px] uppercase tracking-[.14em] text-[var(--muted-2)]">Collections</p><h1 className="mt-1 text-[20px] font-semibold tracking-[-.035em]">Cases & Limited Drops</h1><p className="mt-1.5 text-[10px] leading-5 text-[var(--muted)]">Шансы раскрыты до открытия. Все награды виртуальные и не имеют денежной стоимости.</p></div><Link href="/store?category=cases" className="mxm-quick-link"><Star size={13} fill="currentColor" />Купить</Link></header>
    {error ? <div className="mxm-alert mxm-alert-error mb-3">{error}</div> : null}
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
      <section className="mxm-card p-4">
        <div className="mxm-hscroll gap-2 pb-1">{data?.cases.map((item) => <button key={item.sku} onClick={() => { setSelected(item.sku); setReward(null); }} className={`mxm-filter-chip ${selected === item.sku ? "is-active" : ""}`}>{item.title}<span className="text-[8px] opacity-60">×{item.quantity}</span></button>)}</div>
        <div className={`mxm-case-stage mt-4 grid min-h-[260px] place-items-center rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-5 text-center ${opening ? "is-opening" : ""}`}>
          {reward ? <div className="mxm-case-reward"><Sparkles size={34} className="mx-auto text-[#f5c451]" /><p className="mt-3 text-[9px] uppercase tracking-[.16em] text-[var(--muted)]">{reward.rarity}</p><p className="mt-1 text-lg font-semibold">{reward.label}</p><p className="mt-2 text-[9px] text-[var(--muted)]">Награда добавлена в аккаунт</p></div> : <div><PackageOpen size={48} className="mx-auto text-[var(--accent)]" /><h2 className="mt-4 text-base font-semibold">{current?.title || "Загрузка…"}</h2><p className="mx-auto mt-2 max-w-sm text-[10px] leading-5 text-[var(--muted)]">{current?.description}</p>{current?.remaining != null ? <p className="mt-3 text-[9px] text-[#f3d789]">Limited: осталось {current.remaining.toLocaleString("ru-RU")}</p> : null}</div>}
        </div>
        {current?.quantity ? <button type="button" disabled={opening} onClick={() => void open()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] bg-white py-3 text-[11px] font-semibold text-black disabled:opacity-40"><PackageOpen size={15} />{opening ? "Открываем…" : `Открыть · ${current.quantity} в инвентаре`}</button> : <Link href="/store?category=cases" className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] bg-white py-3 text-[11px] font-semibold text-black"><PackageOpen size={15} />Купить кейс в MXM Store</Link>}
      </section>
      <aside className="space-y-3">
        <section className="mxm-card overflow-hidden"><div className="mxm-section-head"><span>Вероятности</span><span>100%</span></div><div className="divide-y divide-[var(--border-soft)] px-3">{current?.odds.map((odd) => <div key={`${odd.reward}:${odd.rarity}`} className="flex items-center gap-2 py-2.5"><Gem size={11} className="text-[var(--accent)]" /><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-medium">{odd.label}</p><p className="mt-0.5 text-[8px] text-[var(--muted)]">{odd.rarity}</p></div><span className="text-[10px]">{odd.percent.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%</span></div>)}</div></section>
        <section className="mxm-card overflow-hidden"><div className="mxm-section-head"><span>Последние открытия</span><Clock3 size={12} /></div><div className="divide-y divide-[var(--border-soft)] px-3">{data?.history.length ? data.history.slice(0, 8).map((item) => <div key={item.id} className="py-2.5"><p className="truncate text-[10px] font-medium">{item.rewardLabel}</p><p className="mt-1 text-[8px] text-[var(--muted)]">{item.rarity} · {new Date(item.openedAt).toLocaleString("ru-RU")}</p></div>) : <p className="py-6 text-center text-[9px] text-[var(--muted)]">История пока пуста</p>}</div></section>
      </aside>
    </div>
  </div>;
}
