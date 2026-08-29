"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Award, BadgeCheck, BarChart3, Gem, Gift, ShieldCheck, TrendingUp } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { PublicProfile } from "@/lib/types";
import { money } from "@/lib/format";
import { GiftCard } from "@/components/gifts/gift-card";
import { CoinAvatar } from "@/components/ui";
import { ProfileAvatar, ProfileBadgeList } from "@/components/profile-avatar";

type TraderStats = { tradeCount: number; tradeVolume: number; giftTradeVolume: number; coinTradeVolume: number; closedTrades: number; winningTrades: number; winRate: number; activeDays: number; collectorScore: number; collectorRank: number | null; giftCount: number; uniqueCollections: number; rareGiftCount: number; avgRarityScore: number; collectionValue: number };
type TraderProfile = PublicProfile & { trader?: TraderStats };

export default function PublicProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<TraderProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch<{ profile: TraderProfile }>(`/api/users/${id}`).then((result) => setProfile(result.profile)).catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить игрока")); }, [id]);
  if (!profile) return <div className="mx-auto max-w-5xl"><div className="mxm-skeleton h-56 rounded-[18px]" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  const trader = profile.trader;

  return <div className="mx-auto max-w-5xl">
    <Link href="/leaderboard" className="mb-3 inline-flex items-center gap-2 text-xs text-[var(--muted)]"><ArrowLeft size={15} />Рейтинг</Link>
    <section className="rounded-[20px] border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5">
      <div className="flex items-center gap-3"><ProfileAvatar photoUrl={profile.photoUrl} name={profile.firstName} equippedFrame={profile.equippedProfileFrame} size="large" /><div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-1.5"><h1 className="truncate text-lg font-semibold">{profile.name}</h1>{profile.creatorVerified ? <span className="inline-flex shrink-0 items-center gap-1 rounded-[10px] bg-[rgba(85,225,190,.10)] px-2 py-1 text-[9px] text-[var(--positive)]"><BadgeCheck size={10} />Verified creator</span> : null}</div><p className="mt-0.5 text-[11px] text-[var(--muted)]">LVL {profile.level} · в MXM с {new Date(profile.joinedAt).toLocaleDateString("ru-RU", { month: "short", year: "numeric" })}</p>{profile.reputation ? <p className="mt-1 flex items-center gap-1 text-[10px] text-[var(--muted)]"><ShieldCheck size={11} />Репутация {profile.reputation.score}/100</p> : null}</div></div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Сделки" value={String(trader?.tradeCount ?? profile.tradeCount)} /><Metric label="Объём" value={money(trader?.tradeVolume ?? profile.giftTradeVolume + profile.coinTradeVolume)} /><Metric label="Win rate" value={`${(trader?.winRate || 0).toFixed(1)}%`} /><Metric label="Активных дней" value={String(trader?.activeDays || 0)} /></div>

      <Link href="/leaderboard" className="mt-3 block rounded-[18px] border border-[var(--border-soft)] bg-[var(--panel-2)] p-3.5"><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1.5 text-xs font-semibold"><Gem size={13} className="text-[var(--accent)]" />Collector Score</p><p className="mt-1 text-[9px] text-[var(--muted)]">Редкость, разнообразие и активность коллекции</p></div><div className="text-right"><p className="text-xl font-semibold text-[var(--accent)]">{(trader?.collectorScore || 0).toFixed(1)}</p><p className="text-[9px] text-[var(--muted)]">{trader?.collectorRank ? `#${trader.collectorRank}` : "без ранга"}</p></div></div><div className="mt-3 grid grid-cols-3 gap-2"><Mini value={String(trader?.uniqueCollections || 0)} label="коллекций" /><Mini value={String(trader?.rareGiftCount || 0)} label="редких" /><Mini value={(trader?.avgRarityScore || 0).toFixed(1)} label="ср. редкость" /></div></Link>

      {profile.profileBadges?.length ? <div className="mt-3 border-t border-[var(--border-soft)] pt-3"><p className="mb-2 text-[9px] uppercase tracking-[.12em] text-[var(--muted-2)]">Значки профиля</p><ProfileBadgeList badges={profile.profileBadges} /></div> : null}
      <p className="mt-3 text-[9px] text-[var(--muted-2)]">Баланс и себестоимость портфеля приватны. Публичны только рыночные показатели активности.</p>
    </section>

    {profile.achievements.length ? <section className="mt-4"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><Award size={15} />Достижения</div><div className="flex flex-wrap gap-2">{profile.achievements.map((a) => <span key={a.key} title={a.description} className="inline-flex items-center gap-1.5 rounded-[13px] border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2 text-[10px]"><Award size={11} className="text-[var(--accent)]" />{a.title}</span>)}</div></section> : null}
    <section className="mt-4"><div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-medium"><Gift size={15} />Коллекция</div><span className="text-[10px] text-[var(--muted)]">{profile.giftCount} подарков</span></div>{profile.showcase.length ? <div className="market-grid grid gap-2.5">{profile.showcase.map((gift) => <GiftCard key={gift.virtualGiftId} gift={gift} showOwner />)}</div> : <Empty text="В коллекции нет подарков" />}</section>
    <section className="mt-4"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><BarChart3 size={15} />Созданные мемкоины · {profile.createdCoinCount}</div>{profile.createdCoins.length ? <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)]"><div className="divide-y divide-[var(--border-soft)]">{profile.createdCoins.map((coin) => <Link href={`/coin/${coin.id}`} key={coin.id} className="flex items-center justify-between gap-3 p-3 hover:bg-[var(--panel-2)]"><div className="flex min-w-0 items-center gap-2.5"><CoinAvatar symbol={coin.symbol} imageUrl={coin.imageUrl} /><div className="min-w-0"><p className="truncate text-sm font-medium">{coin.name}</p><p className="text-[10px] text-[var(--muted)]">${coin.symbol} · {coin.holderCount} владельцев</p></div></div><div className="text-right"><p className="text-xs">{money(coin.marketCap)}</p><p className={`text-[10px] ${coin.change24h >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}><TrendingUp size={9} className="mr-1 inline" />{coin.change24h >= 0 ? "+" : ""}{coin.change24h.toFixed(1)}%</p></div></Link>)}</div></div> : <Empty text="Созданных мемкоинов нет" />}</section>
  </div>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-[16px] bg-[var(--panel-2)] p-3"><p className="text-[9px] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>; }
function Mini({ label, value }: { label: string; value: string }) { return <div><b className="block text-[11px]">{value}</b><span className="text-[8px] text-[var(--muted)]">{label}</span></div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-8 text-center text-xs text-[var(--muted)]">{text}</div>; }
