"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Award, Bell, ChevronRight, LockKeyhole, ShieldCheck, Sparkles, Star, UserRound, UsersRound } from "lucide-react";
import { useTelegramProfile } from "@/components/telegram-provider";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import type { Achievement, Reputation } from "@/lib/types";

type Meta = { reputation: Reputation; achievements: Achievement[] };

export default function ProfilePage() {
  const { profile } = useTelegramProfile();
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => { if (profile) apiFetch<Meta>("/api/profile/meta", { cacheMs: 20_000 }).then(setMeta).catch(() => undefined); }, [profile]);
  if (!profile) return null;

  return <div className="mx-auto max-w-2xl">
    <section className="mxm-summary-card p-4">
      <div className="flex items-center gap-3">{profile.photoUrl ? <img src={profile.photoUrl} alt="Профиль Telegram" className="h-13 w-13 rounded-[18px] object-cover ring-1 ring-white/[.08]" /> : <span className="grid h-13 w-13 place-items-center rounded-[18px] border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"><UserRound size={21} /></span>}<div className="min-w-0 flex-1"><h1 className="truncate text-base font-semibold">{profile.firstName} {profile.lastName || ""}</h1><p className="mt-0.5 text-[11px] text-[var(--muted)]">{profile.username ? `@${profile.username}` : `Telegram ${profile.telegramId}`}</p><div className="mt-1.5 flex flex-wrap gap-1.5"><span className="inline-flex rounded-[10px] bg-[rgba(139,164,255,.10)] px-2 py-1 text-[9px] text-[var(--accent)] ring-1 ring-[rgba(139,164,255,.12)]">{profile.tier}</span>{meta ? <span className="inline-flex items-center gap-1 rounded-[10px] bg-white/[.04] px-2 py-1 text-[9px]"><ShieldCheck size={10} />Репутация {meta.reputation.score}</span> : null}</div></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4"><Metric label="Капитал" value={money(profile.netWorth)} /><Metric label="Доступно" value={money(profile.availableBalance)} /><Metric label="Подарки" value={money(profile.giftValue)} /><Metric label="Мемкоины" value={money(profile.coinValue)} /></div>
      <div className="mt-2 rounded-[16px] border border-[var(--border-soft)] bg-[var(--surface)] p-3"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-[15px] bg-[var(--panel-2)] text-[var(--accent)]"><Sparkles size={14} /></span><div className="min-w-0"><p className="text-xs font-medium">Уровень {profile.level}</p><p className="truncate text-[9px] text-[var(--muted)]">{profile.xp} XP · {profile.xpForNextLevel} до следующего</p></div></div><span className="shrink-0 text-[9px] text-[var(--muted)]">Активность</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(profile.levelProgress * 100)}%` }} /></div></div>
      {profile.reservedBalance > 0 ? <div className="mt-2 flex items-center justify-between rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 text-[10px]"><span className="flex items-center gap-1.5 text-[var(--muted)]"><LockKeyhole size={12} />Открытые офферы</span><span>{money(profile.reservedBalance)} в резерве</span></div> : null}
    </section>

    <section className="mt-3 grid grid-cols-2 gap-2"><ProfileAction href="/watchlist" icon={<Star size={15} fill="currentColor" />} title="Избранное" detail="Watchlist и price alerts" /><ProfileAction href="/notifications" icon={<Bell size={15} />} title="Уведомления" detail="События и настройки" /><ProfileAction href="/support" icon={<Star size={15} fill="currentColor" />} title="Stars" detail="Пополнить баланс" /><ProfileAction href="/referrals" icon={<UsersRound size={15} />} title="Рефералы" detail="Бонусы от приглашённых" /></section>

    {meta?.achievements.length ? <section className="mt-4"><div className="mb-2 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-medium"><Award size={15} />Достижения</h2><span className="text-[10px] text-[var(--muted)]">{meta.achievements.length}</span></div><div className="grid gap-2 sm:grid-cols-2">{meta.achievements.map((a) => <div key={a.key} className="mxm-card p-3"><div className="flex items-start gap-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-[14px] bg-[var(--panel-2)] text-[var(--accent)]"><Award size={13} /></span><div className="min-w-0"><p className="text-xs font-medium">{a.title}</p><p className="mt-0.5 text-[9px] leading-4 text-[var(--muted)]">{a.description}</p>{a.xpReward ? <p className="mt-1 text-[9px] text-[var(--accent)]">+{a.xpReward} XP</p> : null}</div></div></div>)}</div></section> : null}

    <Link href={`/u/${profile.id}`} className="mxm-card mt-4 flex items-center gap-3 p-3"><UserRound size={15} /><div className="min-w-0 flex-1"><p className="text-xs font-medium">Публичный профиль</p><p className="text-[9px] text-[var(--muted)]">Так ваш аккаунт видят другие игроки</p></div><ChevronRight size={14} className="text-[var(--muted)]" /></Link>
    <Link href="/about" className="mxm-card mt-2 flex items-center gap-3 p-3"><ShieldCheck size={15} /><div className="min-w-0 flex-1"><p className="text-xs font-medium">О MXM и рекламных наградах</p><p className="text-[9px] text-[var(--muted)]">Виртуальный баланс, добровольная реклама и правила</p></div><ChevronRight size={14} className="text-[var(--muted)]" /></Link>
  </div>;
}

function ProfileAction({ href, icon, title, detail }: { href: string; icon: React.ReactNode; title: string; detail: string }) { return <Link href={href} className="mxm-profile-action">{icon}<span><b>{title}</b><small>{detail}</small></span></Link>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="min-w-0 rounded-[14px] border border-[var(--border-soft)] bg-[var(--panel-2)] p-2.5"><p className="text-[9px] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-xs font-semibold">{value}</p></div>; }
