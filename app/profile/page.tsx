"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, Award, BadgeCheck, BarChart3, Bell, ChevronRight, Gem, Handshake, LockKeyhole, Palette, ShieldCheck, Sparkles, Star, Store, Trophy, UserRound, UsersRound } from "lucide-react";
import { ProfileAvatar, ProfileBadgeList } from "@/components/profile-avatar";
import { useTelegramProfile } from "@/components/telegram-provider";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import type { Achievement, ProfileBadge, Reputation } from "@/lib/types";

type TraderStats = {
  tradeCount: number;
  tradeVolume: number;
  giftTradeVolume: number;
  coinTradeVolume: number;
  closedTrades: number;
  winningTrades: number;
  winRate: number;
  activeDays: number;
  lastActivityAt: string | null;
  collectorScore: number;
  collectorRank: number | null;
  giftCount: number;
  uniqueCollections: number;
  rareGiftCount: number;
  avgRarityScore: number;
  collectionValue: number;
};

type Meta = {
  reputation: Reputation;
  trader: TraderStats;
  achievements: Achievement[];
  achievementCount: number;
  appearance: { equippedProfileFrame: string | null; creatorVerified: boolean; badges: ProfileBadge[] };
};

export default function ProfilePage() {
  const { profile } = useTelegramProfile();
  const profileId = profile?.id || null;
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!profileId) return;
    const controller = new AbortController();
    setMetaError(null);
    void apiFetch<Meta>("/api/profile/meta", { cacheMs: 20_000, signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setMeta(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setMetaError(cause instanceof Error ? cause.message : "Не удалось загрузить данные профиля");
      });
    return () => controller.abort();
  }, [profileId, retryKey]);

  if (!profile) return null;
  const trader = meta?.trader;

  return <div className="mx-auto max-w-3xl">
    {metaError ? <div className="mb-3 flex items-center justify-between gap-3 mxm-alert mxm-alert-error"><span>{metaError}</span><button type="button" className="shrink-0 underline" onClick={() => setRetryKey((value) => value + 1)}>Повторить</button></div> : null}

    <section className="mxm-summary-card p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <ProfileAvatar photoUrl={profile.photoUrl} name={profile.firstName} equippedFrame={meta?.appearance.equippedProfileFrame || null} size="large" />
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-lg font-semibold">{profile.firstName} {profile.lastName || ""}</h1>{meta?.appearance.creatorVerified ? <span className="inline-flex items-center gap-1 rounded-[10px] bg-[rgba(85,225,190,.10)] px-2 py-1 text-[10px] text-[var(--positive)]"><BadgeCheck size={11} />Verified</span> : null}</div><p className="mt-0.5 text-[11px] text-[var(--muted)]">{profile.username ? `@${profile.username}` : "Telegram Trader"} · LVL {profile.level}{profile.prestigeLevel > 0 ? ` · P${profile.prestigeLevel}` : ""}</p></div>
        <Link href={`/u/${profile.id}`} aria-label="Публичный профиль" className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-[var(--panel-2)] text-[var(--muted)]"><UserRound size={16} /></Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <HeroMetric label="Капитал" value={money(profile.netWorth)} />
        <HeroMetric label="PnL" value={`${profile.pnl >= 0 ? "+" : ""}${money(profile.pnl)}`} tone={profile.pnl} />
        <HeroMetric label="Объём" value={trader ? money(trader.tradeVolume) : "—"} />
        <HeroMetric label="Win rate" value={trader ? `${trader.winRate.toFixed(1)}%` : "—"} />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-[1.15fr_.85fr]">
        <Link href="/leaderboard" className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--panel-2)] p-3.5 transition hover:border-[var(--border)]">
          <div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1.5 text-[11px] font-semibold"><Gem size={13} className="text-[var(--accent)]" />Collector Score</p><p className="mt-1 text-[10px] text-[var(--muted)]">Редкость + разнообразие + ценность + торговая активность</p></div><div className="text-right"><p className="text-xl font-semibold text-[var(--accent)]">{trader ? trader.collectorScore.toFixed(1) : "—"}</p><p className="text-[9px] text-[var(--muted)]">{trader?.collectorRank ? `#${trader.collectorRank} в MXM` : "без ранга"}</p></div></div>
          <div className="mt-3 grid grid-cols-3 gap-2"><MiniMetric value={String(trader?.uniqueCollections || 0)} label="коллекций" /><MiniMetric value={String(trader?.rareGiftCount || 0)} label="редких" /><MiniMetric value={trader ? trader.avgRarityScore.toFixed(1) : "0"} label="ср. редкость" /></div>
        </Link>
        <div className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--panel-2)] p-3.5"><p className="text-[11px] font-semibold">Trader activity</p><div className="mt-3 grid grid-cols-2 gap-y-3"><MiniMetric value={String(trader?.tradeCount || 0)} label="сделок" /><MiniMetric value={String(trader?.activeDays || 0)} label="активных дней" /><MiniMetric value={money(trader?.giftTradeVolume || 0)} label="gift volume" /><MiniMetric value={money(trader?.coinTradeVolume || 0)} label="coin volume" /></div></div>
      </div>

      <div className="mt-4 border-t border-[var(--border-soft)] pt-3"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><Sparkles size={14} className="text-[var(--accent)]" /><div><p className="text-[11px] font-medium">Уровень {profile.level}</p><p className="text-[9px] text-[var(--muted)]">{profile.xp.toLocaleString("ru-RU")} XP · ещё {profile.xpForNextLevel.toLocaleString("ru-RU")}</p></div></div><span className="text-[10px] text-[var(--muted)]">{Math.round(profile.levelProgress * 100)}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--panel-3)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(profile.levelProgress * 100)}%` }} /></div></div>
      {profile.reservedBalance > 0 ? <div className="mt-3 flex items-center justify-between text-[10px]"><span className="flex items-center gap-1.5 text-[var(--muted)]"><LockKeyhole size={12} />В заявках и обменах</span><span>{money(profile.reservedBalance)}</span></div> : null}
      {meta?.appearance.badges?.length ? <div className="mt-3 border-t border-[var(--border-soft)] pt-3"><p className="mb-2 text-[9px] uppercase tracking-[.12em] text-[var(--muted-2)]">Бейджи</p><ProfileBadgeList badges={meta.appearance.badges} /></div> : null}
    </section>

    <section className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <ProfileAction href="/trades" icon={<Handshake size={16} />} title="Trade Center" detail="Обмены подарками" />
      <ProfileAction href="/social" icon={<Activity size={16} />} title="Сообщество" detail="Живая лента MXM" />
      <ProfileAction href="/leaderboard" icon={<BarChart3 size={16} />} title="Рейтинги" detail="Трейдеры и коллекционеры" />
      <ProfileAction href="/progression" icon={<Trophy size={16} />} title="Прогресс" detail="Уровни и награды" />
      <ProfileAction href="/watchlist" icon={<Star size={16} fill="currentColor" />} title="Избранное" detail="Подарки и монеты" />
      <ProfileAction href="/notifications" icon={<Bell size={16} />} title="Уведомления" detail="События и цены" />
      <ProfileAction href="/store" icon={<Store size={16} />} title="Магазин" detail="MXM и Stars" />
      <ProfileAction href="/profile/customize" icon={<Palette size={16} />} title="Оформление" detail="Рамки и бейджи" />
      <ProfileAction href="/referrals" icon={<UsersRound size={16} />} title="Рефералы" detail="Приглашения" />
    </section>

    {meta?.achievements.length ? <section className="mt-4"><div className="mb-2 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-medium"><Award size={15} />Достижения</h2><Link href="/progression" className="text-[10px] text-[var(--accent)]">Все · {meta.achievementCount}</Link></div><div className="grid gap-2 sm:grid-cols-2">{meta.achievements.slice(0, 4).map((a) => <div key={a.key} className="mxm-profile-achievement"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-[12px] bg-[var(--panel-2)] text-[var(--accent)]"><Award size={13} /></span><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{a.title}</p><p className="mt-0.5 line-clamp-1 text-[9px] text-[var(--muted)]">{a.description}</p></div>{a.xpReward ? <span className="shrink-0 text-[9px] text-[var(--accent)]">+{a.xpReward} XP</span> : null}</div>)}</div></section> : null}

    <Link href="/about" className="mxm-card mt-4 flex items-center gap-3 p-3"><ShieldCheck size={15} /><div className="min-w-0 flex-1"><p className="text-xs font-medium">О MXM</p></div><ChevronRight size={14} className="text-[var(--muted)]" /></Link>
  </div>;
}

function ProfileAction({ href, icon, title, detail }: { href: string; icon: React.ReactNode; title: string; detail: string }) { return <Link href={href} className="mxm-profile-action">{icon}<span><b>{title}</b><small>{detail}</small></span></Link>; }
function HeroMetric({ label, value, tone }: { label: string; value: string; tone?: number }) { return <div className="rounded-[16px] bg-[var(--panel-2)] p-3"><p className="text-[9px] uppercase tracking-[.08em] text-[var(--muted)]">{label}</p><p className={`mt-1 truncate text-sm font-semibold ${tone == null ? "" : tone >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{value}</p></div>; }
function MiniMetric({ label, value }: { label: string; value: string }) { return <div className="min-w-0"><b className="block truncate text-[11px] font-semibold">{value}</b><span className="text-[8px] text-[var(--muted)]">{label}</span></div>; }
