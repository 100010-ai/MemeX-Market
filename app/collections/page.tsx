"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Award, Check, Gem, Gift, Layers3, LockKeyhole, Palette, Search, Sparkles, Shapes } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import { useTelegramProfile } from "@/components/telegram-provider";

type Trait = { owned: number; total: number };
type Collection = {
  baseName: string;
  coverage: number;
  owned: number;
  rarityPoints: number;
  holders: number;
  floorPrice: number | null;
  models: Trait;
  backdrops: Trait;
  symbols: Trait;
  claimedMilestones: number[];
};
type Payload = {
  level: number;
  totalPoints: number;
  nextLevel: number;
  progress: number;
  giftCount: number;
  completed: number;
  collections: Collection[];
  milestones: number[];
};

const DEFAULT_MILESTONES = [25, 50, 75, 100];
const MILESTONE_REWARD: Record<number, string> = {
  25: "250 MXM",
  50: "700 MXM + Starter Case",
  75: "1 500 MXM + Rare Case",
  100: "3 000 MXM + Master badge",
};

function traitPercent(trait: Trait) {
  return trait.total > 0 ? Math.min(100, Math.round((trait.owned / trait.total) * 100)) : 0;
}

export default function CollectionsPage() {
  const { haptic, refreshProfile } = useTelegramProfile();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"progress" | "name" | "floor">("progress");

  const load = useCallback(async () => {
    setData(await apiFetch<Payload>("/api/collections/progress", { cacheMs: 0, dedupe: false }));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить Collection Book"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);


  const milestoneOptions = data?.milestones?.length ? data.milestones : DEFAULT_MILESTONES;

  const visibleCollections = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = (data?.collections || []).filter((item) => !normalized || item.baseName.toLowerCase().includes(normalized));
    return [...rows].sort((a, b) => {
      if (sort === "name") return a.baseName.localeCompare(b.baseName, "ru");
      if (sort === "floor") return (a.floorPrice ?? Number.POSITIVE_INFINITY) - (b.floorPrice ?? Number.POSITIVE_INFINITY);
      return b.coverage - a.coverage || b.rarityPoints - a.rarityPoints;
    });
  }, [data?.collections, query, sort]);

  async function claim(baseName: string, milestone: number) {
    const key = `${baseName}:${milestone}`;
    if (busy) return;
    setBusy(key);
    setNotice(null);
    setError(null);
    try {
      const result = await apiFetch<{ status: string; alreadyClaimed?: boolean }>("/api/collections/progress", {
        method: "POST",
        body: JSON.stringify({ baseName, milestone }),
      });
      haptic("heavy");
      await Promise.all([load(), refreshProfile()]);
      setNotice(result.alreadyClaimed ? `Награда ${milestone}% уже была получена` : `Награда за ${milestone}% коллекции получена`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось получить награду");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-3 border-b border-[var(--border-soft)] pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[.14em] text-[var(--muted-2)]">Collection Book</p>
            <h1 className="mt-1 text-[18px] font-semibold tracking-[-.035em]">Коллекционер · уровень {data?.level || 1}</h1>
            <p className="mt-1 max-w-2xl text-[9px] leading-4 text-[var(--muted)]">
              Книга отдельно считает уникальные Model, Backdrop и Symbol. Чем полнее набор вариантов серии, тем выше процент коллекции и ценнее этапные награды.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[9px] text-[var(--muted)]">Завершено</p>
            <p className="mt-1 text-sm font-semibold">{data?.completed || 0}</p>
            <p className="mt-0.5 text-[8px] text-[var(--muted-2)]">на 100%</p>
          </div>
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-[8px] text-[var(--muted)]">
            <span>{data?.totalPoints || 0} очков редкости</span>
            <span>{data?.nextLevel || 5} до границы уровня</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[.06]">
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round((data?.progress || 0) * 100)}%` }} />
          </div>
        </div>
      </header>

      {error ? <div className="mxm-alert mxm-alert-error mb-3">{error}</div> : null}
      {notice ? <div className="mxm-alert mb-3">{notice}</div> : null}

      <div className="mb-3 grid grid-cols-3 gap-2">
        <Metric icon={<Gift size={13} />} label="Подарки" value={String(data?.giftCount || 0)} />
        <Metric icon={<Award size={13} />} label="100% серий" value={String(data?.completed || 0)} />
        <Metric icon={<Gem size={13} />} label="Очки" value={String(data?.totalPoints || 0)} />
      </div>

      {data?.collections.length ? <div className="mb-3 flex flex-wrap items-center gap-2 border-y border-[var(--border-soft)] py-2">
        <label className="flex min-w-[180px] flex-1 items-center gap-2"><Search size={12} className="text-[var(--muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти серию" className="min-w-0 flex-1 bg-transparent text-[10px] outline-none placeholder:text-[var(--muted-2)]" /></label>
        <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="mxm-compact-select"><option value="progress">По прогрессу</option><option value="name">По названию</option><option value="floor">По floor</option></select>
      </div> : null}

      {visibleCollections.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {visibleCollections.map((item) => {
            const nextMilestone = DEFAULT_MILESTONES.find((milestone) => !item.claimedMilestones.includes(milestone)) || 100;
            return (
              <article key={item.baseName} className="mxm-card overflow-hidden p-3.5">
                <div className="flex items-start gap-3">
                  <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-[14px] ${item.coverage >= 100 ? "bg-[var(--accent)] text-black" : "bg-white/[.045] text-[var(--accent)]"}`}>
                    {item.coverage >= 100 ? <Sparkles size={18} /> : <Layers3 size={18} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/collections/${encodeURIComponent(item.baseName)}`} className="truncate text-[11px] font-semibold hover:underline">
                          {item.baseName}
                        </Link>
                        <p className="mt-0.5 text-[8px] text-[var(--muted)]">{item.owned} предметов · {item.rarityPoints} очков редкости</p>
                      </div>
                      <span className={`shrink-0 text-sm font-semibold ${item.coverage >= 100 ? "text-[var(--positive)]" : "text-white"}`}>{item.coverage}%</span>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[.05]">
                      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${item.coverage}%` }} />
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  <TraitCell icon={<Shapes size={11} />} label="Model" trait={item.models} />
                  <TraitCell icon={<Palette size={11} />} label="Backdrop" trait={item.backdrops} />
                  <TraitCell icon={<Sparkles size={11} />} label="Symbol" trait={item.symbols} />
                </div>

                <div className="mt-3 grid grid-cols-4 gap-1.5">
                  {milestoneOptions.map((milestone) => {
                    const claimed = item.claimedMilestones.includes(milestone);
                    const unlocked = item.coverage >= milestone;
                    const key = `${item.baseName}:${milestone}`;
                    return (
                      <button
                        key={milestone}
                        type="button"
                        disabled={!unlocked || claimed || Boolean(busy)}
                        onClick={() => void claim(item.baseName, milestone)}
                        title={MILESTONE_REWARD[milestone]}
                        className={`min-w-0 rounded-[10px] px-1 py-2 text-center ring-1 disabled:cursor-default ${claimed ? "bg-[var(--positive)]/[.05] text-[var(--positive)] ring-white/[.08]" : unlocked ? "bg-[var(--accent)]/[.06] text-[var(--accent)] ring-white/[.08]" : "bg-white/[.02] text-[var(--muted-2)] ring-white/[.05]"}`}
                      >
                        <span className="mx-auto grid h-4 place-items-center">
                          {claimed ? <Check size={10} /> : unlocked ? (busy === key ? <Sparkles size={10} /> : <Gift size={10} />) : <LockKeyhole size={9} />}
                        </span>
                        <span className="mt-0.5 block text-[7px] font-medium">{milestone}%</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border-soft)] pt-2.5">
                  <div className="min-w-0">
                    <p className="text-[8px] text-[var(--muted)]">Floor {item.floorPrice == null ? "—" : money(item.floorPrice)} · владельцев {item.holders.toLocaleString("ru-RU")}</p>
                    <p className="mt-0.5 truncate text-[7px] text-[var(--muted-2)]">Следующая награда: {MILESTONE_REWARD[nextMilestone]}</p>
                  </div>
                  <div className="flex shrink-0 gap-2"><Link href={`/collections/${encodeURIComponent(item.baseName)}`} className="text-[8px] text-[var(--muted)]">Серия</Link><Link href={`/market?collection=${encodeURIComponent(item.baseName)}`} className="text-[8px] text-[var(--accent)]">Найти на рынке</Link></div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="py-12 text-center">
          <Gift size={25} className="mx-auto text-[var(--muted)]" />
          <p className="mt-3 text-xs font-medium">{data?.collections.length ? "Ничего не найдено" : "Книга пока пуста"}</p>
          <p className="mt-1 text-[9px] text-[var(--muted)]">{data?.collections.length ? "Измени поиск или сортировку." : "Получите первый Telegram-подарок — его Model, Backdrop и Symbol появятся здесь."}</p>
          {!data?.collections.length ? <Link href="/market" className="mt-3 inline-block text-[9px] text-[var(--accent)]">Перейти на рынок</Link> : null}
        </div>
      )}
    </div>
  );
}

function TraitCell({ icon, label, trait }: { icon: React.ReactNode; label: string; trait: Trait }) {
  const percent = traitPercent(trait);
  return (
    <div className="rounded-[11px] bg-white/[.025] px-2 py-2 ring-1 ring-white/[.05]">
      <div className="flex items-center gap-1 text-[7px] text-[var(--muted)]">{icon}{label}</div>
      <p className="mt-1 text-[9px] font-medium">{trait.owned}/{trait.total || 0}</p>
      <div className="mt-1 h-[2px] overflow-hidden rounded-full bg-white/[.05]"><div className="h-full bg-[var(--accent)]" style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="border-y border-[var(--border-soft)] py-2.5">
      <div className="flex items-center gap-1.5 text-[8px] text-[var(--muted)]">{icon}{label}</div>
      <p className="mt-1 text-[12px] font-semibold">{value}</p>
    </div>
  );
}
