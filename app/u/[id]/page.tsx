"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Award, BadgeCheck, BarChart3, Gift, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { PublicProfile } from "@/lib/types";
import { money } from "@/lib/format";
import { GiftCard } from "@/components/gifts/gift-card";
import { CoinAvatar } from "@/components/ui";
import { ProfileAvatar, ProfileBadgeList } from "@/components/profile-avatar";
import { traderLevelTitle } from "@/lib/trader-level";

export default function PublicProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch<{ profile: PublicProfile }>(`/api/users/${id}`).then((result) => setProfile(result.profile)).catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить игрока")); }, [id]);
  if (!profile) return <div className="mx-auto max-w-5xl"><div className="mxm-skeleton h-56 rounded-[18px]" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  return <div className="mx-auto max-w-5xl">
    <Link href="/leaderboard" className="mb-3 inline-flex items-center gap-2 text-xs text-[var(--muted)]"><ArrowLeft size={15} />Рейтинг</Link>
    <section className="rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-center gap-3"><ProfileAvatar photoUrl={profile.photoUrl} name={profile.firstName} equippedFrame={profile.equippedProfileFrame} size="large" /><div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-1.5"><h1 className="truncate text-base font-semibold">{profile.name}</h1>{profile.creatorVerified ? <span className="inline-flex shrink-0 items-center gap-1 rounded-[10px] bg-[rgba(85,225,190,.10)] px-2 py-1 text-[9px] text-[var(--positive)] ring-1 ring-[rgba(85,225,190,.16)]"><BadgeCheck size={10} />Проверенный автор</span> : null}</div><p className="mt-0.5 text-xs text-[var(--muted)]">Ур. {profile.level} · {traderLevelTitle(profile.level)} · регистрация {new Date(profile.joinedAt).toLocaleDateString("ru-RU")}</p>{profile.reputation ? <p className="mt-1 flex items-center gap-1 text-[10px] text-[var(--muted)]"><ShieldCheck size={11} />Репутация {profile.reputation.score}/100</p> : null}</div></div>
      {profile.profileBadges?.length ? <div className="mt-3 border-t border-[var(--border-soft)] pt-3"><p className="mb-2 text-[9px] uppercase tracking-[.12em] text-[var(--muted-2)]">Значки профиля</p><ProfileBadgeList badges={profile.profileBadges} /></div> : null}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5"><Metric label="Подарки" value={String(profile.giftCount)} /><Metric label="Продажи подарков" value={String(profile.giftSales)} /><Metric label="Объём подарков" value={money(profile.giftTradeVolume)} /><Metric label="Объём мемкоинов" value={money(profile.coinTradeVolume)} /><Metric label="Опыт" value={String(profile.xp)} /></div>
      <p className="mt-3 text-[9px] text-[var(--muted-2)]">Баланс, стоимость портфеля, себестоимость и прибыль/убыток приватны и не публикуются в профиле.</p>
    </section>
    {profile.achievements.length ? <section className="mt-4"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><Award size={15} />Достижения</div><div className="flex flex-wrap gap-2">{profile.achievements.map((a) => <span key={a.key} title={a.description} className="inline-flex items-center gap-1.5 rounded-[13px] border border-[var(--border)] bg-[var(--panel)] px-2.5 py-2 text-[10px]"><Award size={11} className="text-[var(--accent)]" />{a.title}</span>)}</div></section> : null}
    <section className="mt-3"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><Gift size={15} />Витрина подарков</div>{profile.showcase.length ? <div className="market-grid grid gap-2.5">{profile.showcase.map((gift) => <GiftCard key={gift.virtualGiftId} gift={gift} showOwner />)}</div> : <Empty text="В коллекции нет подарков" />}</section>
    <section className="mt-4"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><BarChart3 size={15} />Созданные мемкоины · {profile.createdCoinCount}</div>{profile.createdCoins.length ? <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)]"><div className="divide-y divide-[var(--border-soft)]">{profile.createdCoins.map((coin) => <Link href={`/coin/${coin.id}`} key={coin.id} className="flex items-center justify-between gap-3 p-3 hover:bg-[var(--panel-2)]"><div className="flex min-w-0 items-center gap-2.5"><CoinAvatar symbol={coin.symbol} imageUrl={coin.imageUrl} /><div className="min-w-0"><p className="truncate text-sm font-medium">{coin.name}</p><p className="text-[10px] text-[var(--muted)]">${coin.symbol} · {coin.holderCount} владельцев</p></div></div><div className="text-right"><p className="text-xs">{money(coin.marketCap)}</p><p className="text-[10px] text-[var(--muted)]">капитализация</p></div></Link>)}</div></div> : <Empty text="Созданных мемкоинов нет" />}</section>
  </div>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-[18px] bg-[var(--panel-2)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-8 text-center text-xs text-[var(--muted)]">{text}</div>; }
