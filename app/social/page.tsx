"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, Diamond, Eye, Flame, Gift, Handshake, RefreshCw, UsersRound } from "lucide-react";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { apiFetch } from "@/lib/api";
import { ago, money } from "@/lib/format";
import type { ActivityItem } from "@/lib/types";

type ReactionKey = "fire" | "eyes" | "diamond";
type SocialItem = ActivityItem & {
  eventId: string | null;
  followingActor: boolean;
  reactions: { fire: number; eyes: number; diamond: number; viewerReaction: ReactionKey | null };
};
type Payload = { mode: "all" | "following"; activity: SocialItem[]; followingCount: number };
type Filter = "all" | "gifts" | "coins" | "swaps";
const realtimeTables = ["activity_events_v074", "social_reactions_v200", "profile_follows_v200"];

function isVisibleInFilter(item: SocialItem, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "coins") return item.kind === "coin" || item.kind === "launch";
  if (filter === "swaps") return item.kind === "offer";
  return item.kind === "gift" || item.kind === "listing" || item.kind === "reprice" || item.kind === "unlist";
}

export default function SocialPage() {
  const [mode, setMode] = useState<"all" | "following">("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [data, setData] = useState<Payload>({ mode: "all", activity: [], followingCount: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const payload = await apiFetch<Payload>(`/api/social/feed?mode=${mode}&limit=60`, { cacheMs: 0, dedupe: false });
      setData(payload); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить ленту"); }
    finally { if (!silent) setLoading(false); }
  }, [mode]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const realtimeReload = useCallback(() => { void load(true); }, [load]);
  const items = useMemo(() => data.activity.filter((item) => isVisibleInFilter(item, filter)), [data.activity, filter]);

  async function react(item: SocialItem, reaction: ReactionKey) {
    if (!item.eventId || busy) return;
    setBusy(`${item.eventId}:${reaction}`);
    const previous = data;
    setData((current) => ({ ...current, activity: current.activity.map((candidate) => {
      if (candidate.eventId !== item.eventId) return candidate;
      const currentReaction = candidate.reactions.viewerReaction;
      const counts = { ...candidate.reactions };
      if (currentReaction) counts[currentReaction] = Math.max(0, counts[currentReaction] - 1);
      if (currentReaction !== reaction) counts[reaction] += 1;
      counts.viewerReaction = currentReaction === reaction ? null : reaction;
      return { ...candidate, reactions: counts };
    }) }));
    try { await apiFetch("/api/social/reactions", { method: "POST", body: JSON.stringify({ eventId: item.eventId, reaction }) }); }
    catch (cause) { setData(previous); setError(cause instanceof Error ? cause.message : "Не удалось поставить реакцию"); }
    finally { setBusy(null); }
  }

  return <div className="mx-auto max-w-3xl">
    <RealtimeRefresh channelName="mxm-social-v200" tables={realtimeTables} onChange={realtimeReload} debounceMs={900} />
    <header className="mb-4 flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.13em] text-[var(--muted-2)]">MXM Community</p><h1 className="mt-1 flex items-center gap-2 text-lg font-semibold"><UsersRound size={18} />Сообщество</h1><p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">Покупки, запуски, редкие события и Trade Offers в одном живом потоке.</p></div><button type="button" onClick={() => void load()} className="grid h-10 w-10 place-items-center rounded-[14px] bg-[var(--panel-2)] text-[var(--muted)]"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button></header>

    <div className="mb-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setMode("all")} className={`min-h-11 rounded-[15px] text-[11px] font-medium ${mode === "all" ? "bg-white text-black" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}>Весь рынок</button><button type="button" onClick={() => setMode("following")} className={`min-h-11 rounded-[15px] text-[11px] font-medium ${mode === "following" ? "bg-white text-black" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}>Подписки · {data.followingCount}</button></div>
    <div className="mxm-hscroll mb-4 flex gap-2 pb-1">{([['all','Все'],['gifts','Подарки'],['coins','Мемкоины'],['swaps','Обмены']] as const).map(([key,label]) => <button key={key} type="button" onClick={() => setFilter(key)} className={`min-h-9 shrink-0 rounded-[13px] px-3 text-[10px] ${filter === key ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}>{label}</button>)}</div>
    {error ? <div className="mxm-alert mxm-alert-error mb-3">{error}</div> : null}

    {loading && !data.activity.length ? <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="mxm-skeleton h-28 rounded-[18px]" />)}</div> : items.length ? <div className="space-y-2">{items.map((item) => <article key={item.id} className="rounded-[19px] border border-[var(--border)] bg-[var(--panel)] p-3.5">
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[13px] bg-[var(--panel-2)] text-[var(--accent)]">{item.kind === "coin" || item.kind === "launch" ? <Activity size={15} /> : item.kind === "offer" ? <Handshake size={15} /> : <Gift size={15} />}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[11px] font-medium">{item.label}</p><span className="shrink-0 text-[8px] text-[var(--muted-2)]">{ago(item.createdAt)}</span></div><Link href={item.href} className="mt-1 inline-flex max-w-full items-center gap-1 text-sm font-semibold"><span className="truncate">{item.detail}</span><ArrowUpRight size={11} className="shrink-0 text-[var(--muted)]" /></Link>{item.amount != null ? <p className="mt-1 text-[10px] text-[var(--muted)]">{money(item.amount)}</p> : null}{item.actorId ? <Link href={`/u/${item.actorId}`} className="mt-2 inline-block text-[9px] text-[var(--accent)]">Профиль трейдера</Link> : null}</div></div>
      {item.eventId ? <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--border-soft)] pt-2.5"><ReactionButton active={item.reactions.viewerReaction === "fire"} icon={<Flame size={12} />} value={item.reactions.fire} onClick={() => void react(item,"fire")} /><ReactionButton active={item.reactions.viewerReaction === "eyes"} icon={<Eye size={12} />} value={item.reactions.eyes} onClick={() => void react(item,"eyes")} /><ReactionButton active={item.reactions.viewerReaction === "diamond"} icon={<Diamond size={12} />} value={item.reactions.diamond} onClick={() => void react(item,"diamond")} /></div> : null}
    </article>)}</div> : <div className="rounded-[19px] border border-[var(--border)] bg-[var(--panel)] p-10 text-center text-[11px] text-[var(--muted)]">{mode === "following" ? "Подпишитесь на трейдеров, и здесь появится их активность." : "Событий по этому фильтру пока нет."}</div>}
  </div>;
}

function ReactionButton({ active, icon, value, onClick }: { active: boolean; icon: React.ReactNode; value: number; onClick: () => void }) { return <button type="button" onClick={onClick} className={`inline-flex min-h-8 items-center gap-1.5 rounded-[12px] px-2.5 text-[9px] ${active ? "bg-[rgba(139,164,255,.12)] text-[var(--accent)]" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}>{icon}<span>{value || 0}</span></button>; }
