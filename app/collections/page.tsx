"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Award, Check, Gem, Gift, LockKeyhole, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import { useTelegramProfile } from "@/components/telegram-provider";

type Collection = { baseName: string; owned: number; target: number; complete: boolean; claimed: boolean; rarityPoints: number; holders: number; floorPrice: number | null };
type Payload = { level: number; totalPoints: number; nextLevel: number; progress: number; giftCount: number; completed: number; collections: Collection[]; claimsReady: boolean };

export default function CollectionsPage() {
  const { haptic } = useTelegramProfile();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => setData(await apiFetch<Payload>("/api/collections/progress", { cacheMs: 20_000 })), []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause) => setNotice(cause instanceof Error ? cause.message : "Не удалось загрузить коллекции"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function claim(baseName: string) {
    if (busy) return;
    setBusy(baseName); setNotice(null);
    try {
      const result = await apiFetch<{ status: string; reward?: { mxmCoins?: number } }>("/api/collections/progress", { method: "POST", body: JSON.stringify({ baseName }) });
      if (result.status !== "claimed") throw new Error("Бонус уже получен или серия не завершена");
      haptic("heavy"); setNotice(`Бонус за коллекцию: +${Number(result.reward?.mxmCoins || 0).toLocaleString("ru-RU")} MXM`); await load();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Не удалось получить бонус"); }
    finally { setBusy(null); }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-4 border-b border-[var(--border-soft)] pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[.14em] text-[var(--muted-2)]">Коллекции подарков</p>
            <h1 className="mt-1 text-[20px] font-semibold tracking-[-.035em]">Коллекционер · уровень {data?.level || 1}</h1>
            <p className="mt-1.5 text-[10px] text-[var(--muted)]">Уровень растёт от количества, редкости и уникальности Telegram-подарков.</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[9px] text-[var(--muted)]">Собрано</p>
            <p className="mt-1 text-sm font-semibold">{data?.giftCount || 0} подарков</p>
          </div>
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-[8px] text-[var(--muted)]"><span>{data?.totalPoints || 0} опыта коллекций</span><span>{data?.nextLevel || 5} опыта</span></div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round((data?.progress || 0) * 100)}%` }} /></div>
        </div>
      </header>

      {notice ? <div className="mxm-alert mb-3">{notice}</div> : null}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Metric icon={<Gift size={13} />} label="Подарки" value={String(data?.giftCount || 0)} />
        <Metric icon={<Award size={13} />} label="Серий завершено" value={String(data?.completed || 0)} />
      </div>

      {data?.collections.length ? (
        <div className="grid gap-2 md:grid-cols-2">
          {data.collections.map((item) => (
            <article key={item.baseName} className="mxm-card p-3.5">
              <div className="flex items-start gap-3">
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-[13px] ${item.complete ? "bg-[var(--accent)] text-black" : "bg-white/[.045] text-[var(--muted)]"}`}>
                  {item.complete ? <Sparkles size={17} /> : <Gift size={17} />}
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/collections/${encodeURIComponent(item.baseName)}`} className="truncate text-[12px] font-semibold">{item.baseName}</Link>
                  <p className="mt-1 text-[9px] text-[var(--muted)]">{item.owned}/{item.target} · {item.rarityPoints} очков редкости · {item.holders} владельцев</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, item.owned / item.target * 100)}%` }} /></div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-[var(--border-soft)] pt-3">
                <span className="text-[9px] text-[var(--muted)]">Мин. цена {item.floorPrice == null ? "—" : money(item.floorPrice)}</span>
                {item.claimed ? (
                  <span className="inline-flex items-center gap-1 text-[9px] text-[var(--positive)]"><Check size={11} />Бонус получен</span>
                ) : item.complete ? (
                  <button type="button" disabled={busy !== null || !data.claimsReady} onClick={() => void claim(item.baseName)} className="text-[9px] font-medium text-[var(--accent)]">{busy === item.baseName ? "…" : "Получить бонус"}</button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[9px] text-[var(--muted-2)]"><LockKeyhole size={10} />Значок + MXM</span>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mxm-card grid min-h-56 place-items-center p-6 text-center">
          <div><Gem size={24} className="mx-auto text-[var(--muted)]" /><p className="mt-3 text-xs font-medium">Коллекция пуста</p><Link href="/market" className="mt-3 inline-block text-[10px] text-[var(--accent)]">Найти первый подарок</Link></div>
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="mxm-card flex items-center gap-2.5 p-3"><span className="text-[var(--accent)]">{icon}</span><div><p className="text-[8px] text-[var(--muted)]">{label}</p><p className="mt-0.5 text-xs font-semibold">{value}</p></div></div>; }
