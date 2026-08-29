"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Crown, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";

type Season = { id: string; title: string; startsAt: string; endsAt: string; daysLeft: number; weekNumber: number; theme: string; exclusiveFrameKeys: string[] };
type Payload = { season: Season; nextSeason: Season | null; premium: boolean };

export function BattlePassIntel() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<Payload>("/api/season", { cacheMs: 20_000, signal: controller.signal }).then(setData).catch(() => undefined);
    return () => controller.abort();
  }, []);
  if (!data) return null;
  return <section className="mb-4 grid gap-2 sm:grid-cols-[1.2fr_.8fr]">
    <div className="rounded-[19px] border border-[rgba(139,164,255,.18)] bg-[linear-gradient(145deg,rgba(139,164,255,.09),rgba(255,255,255,.015))] p-3.5">
      <div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[.12em] text-[var(--accent)]"><Crown size={11} />Battle Pass · Week {data.season.weekNumber}</p><h2 className="mt-1 text-sm font-semibold">{data.season.theme || data.season.title}</h2><p className="mt-1 text-[9px] text-[var(--muted)]">{data.premium ? "Premium track активен" : "Free track активен · Premium даёт эксклюзивные награды"}</p></div><span className="rounded-[11px] bg-black/20 px-2 py-1 text-[9px] text-[var(--muted)]">{data.season.daysLeft} дн.</span></div>
      {data.season.exclusiveFrameKeys.length ? <div className="mt-3 border-t border-white/[.06] pt-3"><p className="flex items-center gap-1 text-[9px] text-[#f3d789]"><Sparkles size={10} />Эксклюзивы сезона</p><div className="mt-2 flex flex-wrap gap-1.5">{data.season.exclusiveFrameKeys.slice(0,6).map((key)=><span key={key} className="rounded-[11px] bg-white/[.04] px-2 py-1 text-[8px] text-[var(--muted)]">{key.replaceAll("_"," ")}</span>)}</div></div> : null}
    </div>
    <div className="rounded-[19px] border border-[var(--border)] bg-[var(--panel)] p-3.5"><p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[.1em] text-[var(--muted)]"><CalendarClock size={11} />Следующий сезон</p>{data.nextSeason ? <><h3 className="mt-2 text-xs font-semibold">{data.nextSeason.theme || data.nextSeason.title}</h3><p className="mt-1 text-[9px] text-[var(--muted)]">Week {data.nextSeason.weekNumber} · старт {new Date(data.nextSeason.startsAt).toLocaleDateString("ru-RU",{day:"numeric",month:"short"})}</p><p className="mt-3 text-[8px] leading-4 text-[var(--muted-2)]">Контент следующей недели уже подготовлен сервером. После окончания текущего сезона дорожка переключится автоматически.</p></> : <p className="mt-3 text-[9px] leading-4 text-[var(--muted)]">Следующий сезон ещё не опубликован.</p>}</div>
  </section>;
}
