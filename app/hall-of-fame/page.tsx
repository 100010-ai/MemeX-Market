"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Archive, ArrowUpRight, Crown, Trophy } from "lucide-react";
import { ProfileAvatar } from "@/components/profile-avatar";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";

type Winner = { id: string; rank: number; name: string; photoUrl: string | null; score: number; profit: number; tradeVolume: number };
type Season = { id: string; title: string; startsAt: string; endsAt: string; winners: Winner[] };

export default function HallOfFamePage() {
  const [seasons, setSeasons] = useState<Season[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  useEffect(() => { const controller = new AbortController(); void apiFetch<{ seasons: Season[] }>("/api/hall-of-fame", { cacheMs: 30_000, signal: controller.signal }).then((payload) => { if (!controller.signal.aborted) setSeasons(payload.seasons); }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить архив"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);
  return <div className="mxm-hall-page mx-auto max-w-4xl"><header className="mxm-league-hero"><div><p className="mxm-league-kicker">Архив сезонов</p><h1>Hall of Fame</h1><p>Лучшие трейдеры и сезонные результаты.</p></div><div className="mxm-league-hero-icon"><Archive size={25} /></div></header>{error ? <div className="mxm-alert mxm-alert-error mb-3">{error}</div> : null}{loading ? <div className="space-y-3"><div className="mxm-skeleton h-48 rounded-2xl" /><div className="mxm-skeleton h-48 rounded-2xl" /></div> : seasons.length ? <div className="space-y-3">{seasons.map((season) => <section key={season.id} className="mxm-hall-season"><div className="mxm-section-head"><span className="flex items-center gap-2"><Trophy size={14} />{season.title}</span><span>{new Date(season.endsAt).toLocaleDateString("ru-RU")}</span></div><div className="divide-y divide-[var(--border-soft)]">{season.winners.map((winner) => <Link href={`/u/${winner.id}`} key={winner.id} className="mxm-league-row px-3"><b className={winner.rank === 1 ? "text-[var(--accent)]" : ""}>{winner.rank === 1 ? <Crown size={14} /> : `#${winner.rank}`}</b><ProfileAvatar photoUrl={winner.photoUrl} name={winner.name} equippedFrame={null} size="small" /><span className="min-w-0 flex-1"><strong>{winner.name}</strong><small>Score {Math.round(winner.score).toLocaleString("ru-RU")}</small></span><span className="text-right"><strong className={winner.profit >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>{winner.profit >= 0 ? "+" : ""}{money(winner.profit)}</strong><small>{money(winner.tradeVolume)} оборот</small></span></Link>)}</div></section>)}</div> : <section className="mxm-hall-empty"><Archive size={22} /><h2>Архив появится после первого сезона</h2><p>Текущий рейтинг уже идёт, так что есть шанс занять строчку, пока она не занята чужим ником.</p><Link href="/league">Открыть League <ArrowUpRight size={13} /></Link></section>}</div>;
}
