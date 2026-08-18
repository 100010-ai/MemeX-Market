"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, BarChart3, Gift, Trophy } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { PublicProfile } from "@/lib/types";
import { money } from "@/lib/format";
import { GiftCard } from "@/components/gifts/gift-card";
import { CoinAvatar } from "@/components/ui";

export default function PublicProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch<{ profile: PublicProfile }>(`/api/users/${id}`).then((result) => setProfile(result.profile)).catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить игрока")); }, [id]);
  if (!profile) return <div className="mx-auto max-w-5xl"><div className="mxm-skeleton h-56 rounded-[18px]" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/leaderboard" className="mb-3 inline-flex items-center gap-2 text-xs text-[var(--muted)]"><ArrowLeft size={15} />Рейтинг</Link>
      <section className="rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-4"><div className="flex items-center gap-3">{profile.photoUrl ? <img src={profile.photoUrl} alt="" className="h-12 w-12 rounded-[18px] object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded-[18px] bg-[var(--panel-2)] text-base font-semibold">{profile.firstName.slice(0, 1).toUpperCase()}</span>}<div className="min-w-0 flex-1"><h1 className="truncate text-base font-semibold">{profile.name}</h1><p className="mt-0.5 text-xs text-[var(--muted)]">Ур. {profile.level} · {profile.tier} · регистрация {new Date(profile.joinedAt).toLocaleDateString("ru-RU")}</p></div>{profile.rank ? <div className="rounded-[18px] bg-[var(--panel-2)] px-3 py-2 text-center"><Trophy size={14} className="mx-auto text-[var(--accent)]" /><p className="mt-1 text-xs font-semibold">#{profile.rank}</p></div> : null}</div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5"><Metric label="Капитал" value={money(profile.netWorth)} /><Metric label="Реализованный PnL" value={money(profile.realizedPnl)} tone={profile.realizedPnl} /><Metric label="Подарки" value={`${profile.giftCount} · ${money(profile.giftValue)}`} /><Metric label="Сделки" value={String(profile.tradeCount)} /><Metric label="XP" value={String(profile.xp)} /></div></section>
      <section className="mt-3"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><Gift size={15} />Витрина подарков</div>{profile.showcase.length ? <div className="market-grid grid gap-2.5">{profile.showcase.map((gift) => <GiftCard key={gift.virtualGiftId} gift={gift} showOwner />)}</div> : <Empty text="В коллекции нет подарков" />}</section>
      <section className="mt-4"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><BarChart3 size={15} />Созданные коины</div>{profile.createdCoins.length ? <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)]"><div className="divide-y divide-[var(--border-soft)]">{profile.createdCoins.map((coin) => <Link href={`/coin/${coin.id}`} key={coin.id} className="flex items-center justify-between gap-3 p-3 hover:bg-[var(--panel-2)]"><div className="flex min-w-0 items-center gap-2.5"><CoinAvatar symbol={coin.symbol} imageUrl={coin.imageUrl} /><div className="min-w-0"><p className="truncate text-sm font-medium">{coin.name}</p><p className="text-[10px] text-[var(--muted)]">${coin.symbol} · {coin.holderCount} холдеров</p></div></div><div className="text-right"><p className="text-xs">{money(coin.marketCap)}</p><p className="text-[10px] text-[var(--muted)]">капитализация</p></div></Link>)}</div></div> : <Empty text="Созданных коинов нет" />}</section>
    </div>
  );
}
function Metric({ label, value, tone }: { label: string; value: string; tone?: number }) { return <div className="rounded-[18px] bg-[var(--panel-2)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className={`mt-1 truncate text-sm font-semibold ${tone == null ? "" : tone >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{value}</p></div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-8 text-center text-xs text-[var(--muted)]">{text}</div>; }
