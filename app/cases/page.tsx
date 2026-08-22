"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Clock3, Gem, PackageOpen, ShieldCheck, Sparkles, Star } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { rarityLabel } from "@/lib/ui-copy";
import { useTelegramProfile } from "@/components/telegram-provider";

type PityTier = { current: number; threshold: number; remaining: number } | null;
type CaseOdd = { reward: string; label: string; percent: number; rarity: string };
type CaseItem = {
  sku: string;
  title: string;
  tier: string;
  description: string;
  quantity: number;
  remaining: number | null;
  pity: { rare: PityTier; epic: PityTier; legendary: PityTier; totalOpens: number };
  odds: CaseOdd[];
};
type HistoryItem = { id: string; caseSku: string; rewardLabel: string; rarity: string; openedAt: string; pityTriggered: boolean; pityRarity: string | null };
type Payload = { cases: CaseItem[]; history: HistoryItem[] };
type Reward = { label: string; rarity: string; kind: string; amount: number; creditedEnergy?: number | null; overflowMxmCoins?: number | null; pityTriggered?: boolean; pityRarity?: string | null };
type OpenResult = { status: string; reward: Reward; remaining: number };
type ReelItem = { id: string; label: string; rarity: string; final?: boolean };
type ReelState = { items: ReelItem[]; stopIndex: number; reward: Reward };

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

function textSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildReel(caseItem: CaseItem, reward: Reward): ReelState {
  const source = caseItem.odds.length
    ? caseItem.odds
    : [{ reward: "fallback", label: "Награда MXM", percent: 100, rarity: "common" }];
  const seed = textSeed(`${caseItem.sku}:${reward.label}:${reward.rarity}`);
  const stopIndex = 29 + (seed % 3);
  const length = stopIndex + 7;
  const items: ReelItem[] = [];
  for (let index = 0; index < length; index += 1) {
    let sourceIndex = (seed + index * 7 + Math.floor(index / 3) * 3) % source.length;
    let odd = source[sourceIndex];
    const previous = items[index - 1];
    if (previous && source.length > 1 && previous.label === odd.label) {
      sourceIndex = (sourceIndex + 1 + (seed % (source.length - 1))) % source.length;
      odd = source[sourceIndex];
    }
    items.push({ id: `${index}:${odd.reward}`, label: odd.label, rarity: odd.rarity });
  }
  items[stopIndex] = { id: `winner:${reward.label}`, label: reward.label, rarity: reward.rarity, final: true };
  return { items, stopIndex, reward };
}

function pityPercent(pity: PityTier) {
  if (!pity) return 0;
  return Math.max(3, Math.min(100, (pity.current / Math.max(1, pity.threshold)) * 100));
}

export default function CasesPage() {
  const { haptic } = useTelegramProfile();
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState<string>("case_starter");
  const [opening, setOpening] = useState(false);
  const [reward, setReward] = useState<Reward | null>(null);
  const [reel, setReel] = useState<ReelState | null>(null);
  const [reelPhase, setReelPhase] = useState<"idle" | "armed" | "spinning" | "revealed">("idle");
  const [error, setError] = useState<string | null>(null);
  const openingRequestRef = useRef<{ caseSku: string; requestId: string } | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const reelFrameRef = useRef<number | null>(null);
  const pendingRevealRef = useRef<OpenResult | null>(null);

  const load = useCallback(async () => {
    const payload = await apiFetch<Payload>("/api/cases", { cacheMs: 0, dedupe: false });
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
      if (reelFrameRef.current != null) window.cancelAnimationFrame(reelFrameRef.current);
    };
  }, [load]);

  const current = data?.cases.find((item) => item.sku === selected) || null;
  const totalOwned = useMemo(() => data?.cases.reduce((sum, item) => sum + item.quantity, 0) || 0, [data?.cases]);
  const bestChance = useMemo(() => current?.odds.reduce((best, item) => {
    const ranks: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };
    return (ranks[item.rarity] || 0) > (ranks[best?.rarity || "common"] || 0) ? item : best;
  }, current?.odds[0]) || null, [current]);

  function selectCase(sku: string) {
    if (opening) return;
    setSelected(sku);
    setReward(null);
    setReel(null);
    setReelPhase("idle");
    setError(null);
  }

  const finishReveal = useCallback(() => {
    const result = pendingRevealRef.current;
    if (!result) return;
    if (revealTimerRef.current != null) window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = null;
    pendingRevealRef.current = null;
    setReward(result.reward);
    setReelPhase("revealed");
    setOpening(false);
    haptic("heavy");
    void load().catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Награда получена, но список кейсов не обновился");
    });
  }, [haptic, load]);

  function skipReveal() {
    if (!opening || !pendingRevealRef.current) return;
    finishReveal();
  }

  async function open() {
    if (!current || current.quantity < 1 || opening) return;
    setOpening(true);
    setReward(null);
    setReel(null);
    setReelPhase("idle");
    setError(null);
    haptic("medium");
    try {
      const attempt = openingRequestRef.current?.caseSku === current.sku
        ? openingRequestRef.current
        : { caseSku: current.sku, requestId: crypto.randomUUID() };
      openingRequestRef.current = attempt;
      const result = await apiFetch<OpenResult>("/api/cases", { method: "POST", body: JSON.stringify(attempt) });
      openingRequestRef.current = null;

      pendingRevealRef.current = result;
      const nextReel = buildReel(current, result.reward);
      setReel(nextReel);
      setReelPhase("armed");
      reelFrameRef.current = window.requestAnimationFrame(() => {
        reelFrameRef.current = window.requestAnimationFrame(() => setReelPhase("spinning"));
      });

      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      revealTimerRef.current = window.setTimeout(finishReveal, reducedMotion ? 180 : 1950);
    } catch (cause) {
      pendingRevealRef.current = null;
      setOpening(false);
      setReel(null);
      setReelPhase("idle");
      setError(cause instanceof Error ? cause.message : "Не удалось открыть кейс");
    }
  }

  const reelStyle = reel ? ({ "--mxm-case-stop": reel.stopIndex } as CSSProperties) : undefined;

  return <div className="mx-auto max-w-5xl">
    <header className="mxm-compact-page-head">
      <div className="min-w-0">
        <p className="mxm-eyebrow">Коллекционные серии</p>
        <div className="mt-1 flex items-center gap-2"><h1 className="mxm-page-title">Кейсы MXM</h1><span className="mxm-status-chip">серверный дроп</span></div>
        <p className="mt-1 text-[9px] text-[var(--muted)]">Открытые шансы · pity-гарантии · дубликаты компенсируются MXM.</p>
      </div>
      <Link href="/store?category=cases" className="mxm-compact-link"><Star size={12} fill="currentColor" />Магазин</Link>
    </header>

    {error ? <div className="mxm-alert mxm-alert-error mb-2.5">{error}</div> : null}

    <div className="mxm-case-summary">
      <span><b>{totalOwned}</b> в инвентаре</span>
      <span><b>{data?.cases.length || 0}</b> серий</span>
      <span><b>{data?.history.length || 0}</b> открытий в истории</span>
    </div>

    <div className="mxm-hscroll mxm-case-tabs mt-2.5 gap-1.5 pb-1">
      {data?.cases.map((item) => <button
        key={item.sku}
        type="button"
        disabled={opening}
        onClick={() => selectCase(item.sku)}
        className={`mxm-case-tab ${selected === item.sku ? "is-active" : ""}`}
      >
        <span>{item.title}</span><b>×{item.quantity}</b>
      </button>)}
    </div>

    <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_310px]">
      <section className="min-w-0">
        <div className={`mxm-case-stage-compact ${opening ? "is-opening" : ""} ${reward ? "has-reward" : ""}`}>
          {reel && reelPhase !== "revealed" ? <div className="mxm-case-reel-wrap" aria-live="polite">
            <div className="mxm-case-reel-pointer" aria-hidden="true" />
            <div className="mxm-case-reel-fade is-left" aria-hidden="true" />
            <div className="mxm-case-reel-fade is-right" aria-hidden="true" />
            <div className="mxm-case-reel-viewport">
              <div className={`mxm-case-reel-track ${reelPhase === "spinning" ? "is-spinning" : ""}`} style={reelStyle}>
                {reel.items.map((item) => <div key={item.id} className={`mxm-case-reel-item is-${item.rarity} ${item.final ? "is-winner" : ""}`}>
                  <Gem size={13} />
                  <span>{item.label}</span>
                  <small>{rarityLabel(item.rarity)}</small>
                </div>)}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-center gap-3">
              <p className="text-[9px] text-[var(--muted)]">Результат уже зафиксирован сервером</p>
              <button type="button" onClick={skipReveal} className="mxm-case-skip">Пропустить</button>
            </div>
          </div> : reward ? <div className="mxm-case-reward-compact">
            <span className={`mxm-reward-orb is-${reward.rarity}`}><Sparkles size={23} /></span>
            {reward.pityTriggered ? <span className="mxm-pity-trigger"><ShieldCheck size={9} />Гарантия {rarityLabel(reward.pityRarity || reward.rarity)}</span> : null}
            <p className="mt-2 text-[8px] uppercase tracking-[.15em] text-[var(--muted)]">{rarityLabel(reward.rarity)}</p>
            <p className="mt-1 text-[16px] font-semibold tracking-[-.02em]">{reward.label}</p>
            <p className="mt-1 text-[8px] text-[var(--muted)]">Награда уже зачислена</p>
            {Number(reward.overflowMxmCoins || 0) > 0 ? <p className="mt-1.5 text-[8px] text-[var(--accent)]">Излишек энергии: +{Number(reward.overflowMxmCoins).toLocaleString("ru-RU")} MXM</p> : null}
          </div> : <div className="mxm-case-idle-compact">
            <div className={`mxm-case-art ${CASE_ART_CLASS[current?.sku || ""] || TIER_CLASS[current?.tier || "starter"] || TIER_CLASS.starter}`}><Box size={38} /></div>
            <div className="min-w-0">
              <p className="text-[8px] uppercase tracking-[.13em] text-[var(--muted-2)]">{TIER_LABEL[current?.tier || "starter"] || "Серия MXM"}</p>
              <h2 className="mt-1 text-[15px] font-semibold">{current?.title || "Загрузка…"}</h2>
              <p className="mt-1 max-w-md text-[9px] leading-4 text-[var(--muted)]">{current?.description}</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-[var(--muted)]">
                <span>Инвентарь <b className="font-medium text-white">{current?.quantity || 0}</b></span>
                {current?.remaining != null ? <span>Тираж <b className="font-medium text-white">{current.remaining.toLocaleString("ru-RU")}</b></span> : null}
                {bestChance ? <span>Макс. редкость <b className="font-medium text-white">{rarityLabel(bestChance.rarity)}</b></span> : null}
              </div>
            </div>
          </div>}
        </div>

        {current?.quantity ? <button type="button" disabled={opening} onClick={() => void open()} className="mxm-primary-action mt-2.5 w-full">
          <PackageOpen size={14} />{opening ? "Прокручиваем…" : reward ? `Открыть ещё · ${current.quantity} шт.` : `Открыть кейс · ${current.quantity} шт.`}
        </button> : <Link href="/store?category=cases" className="mxm-primary-action mt-2.5 w-full">
          <PackageOpen size={14} />Купить кейс
        </Link>}
        <p className="mt-1.5 flex items-center justify-center gap-1 text-[7px] text-[var(--muted-2)]"><ShieldCheck size={8} />Idempotency защищает от двойной выдачи при повторном запросе.</p>

        <section className="mt-3 border-t border-[var(--border-soft)] pt-2.5">
          <div className="mb-2 flex items-center justify-between"><p className="text-[9px] font-medium">Персональная гарантия</p><span className="text-[7px] text-[var(--muted-2)]">счётчики по серии</span></div>
          <div className="grid grid-cols-3 gap-1.5">
            {(["rare", "epic", "legendary"] as const).map((rarity) => {
              const pity = current?.pity[rarity] || null;
              return <div key={rarity} className={`mxm-pity-card is-${rarity}`}>
                <div className="flex items-center justify-between gap-1"><span>{rarityLabel(rarity)}</span><b>{pity ? `${pity.current}/${pity.threshold}` : "—"}</b></div>
                <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[.05]"><div className={`h-full rounded-full ${RARITY_BAR[rarity]}`} style={{ width: `${pityPercent(pity)}%` }} /></div>
                <p className="mt-1 text-[7px] text-[var(--muted-2)]">{pity ? (pity.remaining === 1 ? "следующее гарантировано" : `≤ ${pity.remaining} до гарантии`) : "нет порога"}</p>
              </div>;
            })}
          </div>
        </section>
      </section>

      <aside className="min-w-0 space-y-3">
        <section className="border-t border-[var(--border-soft)]">
          <div className="mxm-compact-section-head"><span>Вероятности</span><span>100%</span></div>
          <div className="divide-y divide-[var(--border-soft)]">{current?.odds.map((odd) => <div key={`${odd.reward}:${odd.rarity}`} className="py-2">
            <div className="flex items-center gap-2"><span className={`mxm-rarity-dot is-${odd.rarity}`} /><p className="min-w-0 flex-1 truncate text-[9px] font-medium">{odd.label}</p><span className="text-[9px] tabular-nums">{odd.percent.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%</span></div>
            <div className="mt-1 h-[2px] overflow-hidden rounded-full bg-white/[.04]"><div className={`h-full rounded-full ${RARITY_BAR[odd.rarity] || RARITY_BAR.common}`} style={{ width: `${Math.max(1.5, Math.min(100, odd.percent))}%` }} /></div>
          </div>)}</div>
        </section>

        <section className="border-t border-[var(--border-soft)]">
          <div className="mxm-compact-section-head"><span>Последние открытия</span><Clock3 size={11} /></div>
          <div className="divide-y divide-[var(--border-soft)]">{data?.history.length ? data.history.slice(0, 7).map((item) => <div key={item.id} className="py-2">
            <div className="flex items-center gap-2"><span className={`mxm-rarity-dot is-${item.rarity}`} /><p className="min-w-0 flex-1 truncate text-[9px] font-medium">{item.rewardLabel}</p>{item.pityTriggered ? <span className="text-[7px] text-[#e7c867]">pity</span> : null}</div>
            <p className="mt-0.5 pl-3.5 text-[7px] text-[var(--muted-2)]">{rarityLabel(item.rarity)} · {new Date(item.openedAt).toLocaleString("ru-RU")}</p>
          </div>) : <p className="py-5 text-center text-[8px] text-[var(--muted)]">История пока пуста</p>}</div>
        </section>
      </aside>
    </div>
  </div>;
}
