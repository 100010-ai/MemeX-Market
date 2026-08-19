"use client";

import Link from "next/link";
import { LockKeyhole, Sparkles, UserRound } from "lucide-react";
import { useTelegramProfile } from "@/components/telegram-provider";
import { money } from "@/lib/format";

export default function ProfilePage() {
  const { profile } = useTelegramProfile();
  if (!profile) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <section className="mxm-summary-card p-4">
        <div className="flex items-center gap-3">
          {profile.photoUrl ? <img src={profile.photoUrl} alt="Профиль Telegram" className="h-13 w-13 rounded-[18px] object-cover ring-1 ring-white/[.08]" /> : <span className="grid h-13 w-13 place-items-center rounded-[18px] border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"><UserRound size={21} /></span>}
          <div className="min-w-0 flex-1"><h1 className="truncate text-base font-semibold">{profile.firstName} {profile.lastName || ""}</h1><p className="mt-0.5 text-[11px] text-[var(--muted)]">{profile.username ? `@${profile.username}` : `Telegram ${profile.telegramId}`}</p><span className="mt-1.5 inline-flex rounded-[10px] bg-[rgba(139,164,255,.10)] px-2 py-1 text-[9px] text-[var(--accent)] ring-1 ring-[rgba(139,164,255,.12)]">{profile.tier}</span></div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4"><Metric label="Капитал" value={money(profile.netWorth)} /><Metric label="Доступно" value={money(profile.availableBalance)} /><Metric label="Подарки" value={money(profile.giftValue)} /><Metric label="Мемкоины" value={money(profile.coinValue)} /></div>

        <div className="mt-2 rounded-[16px] border border-[var(--border-soft)] bg-[var(--surface)] p-3"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-[15px] bg-[var(--panel-2)] text-[var(--accent)]"><Sparkles size={14} /></span><div className="min-w-0"><p className="text-xs font-medium">Уровень {profile.level}</p><p className="truncate text-[9px] text-[var(--muted)]">{profile.xp} XP · {profile.xpForNextLevel} до следующего</p></div></div><span className="shrink-0 text-[9px] text-[var(--muted)]">Активность</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(profile.levelProgress * 100)}%` }} /></div></div>

        {profile.reservedBalance > 0 ? <div className="mt-2 flex items-center justify-between rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 text-[10px]"><span className="flex items-center gap-1.5 text-[var(--muted)]"><LockKeyhole size={12} />Открытые офферы</span><span>{money(profile.reservedBalance)} в резерве</span></div> : null}

        <Link href={`/u/${profile.id}`} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] py-2.5 text-[10px] hover:bg-[var(--panel-3)]"><UserRound size={14} />Профиль</Link>
      </section>

    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-[14px] border border-[var(--border-soft)] bg-[var(--panel-2)] p-2.5"><p className="text-[9px] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-xs font-semibold">{value}</p></div>;
}
