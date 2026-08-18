"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays, Gift, LockKeyhole, RefreshCw, Sparkles, Trophy, UserRound } from "lucide-react";
import { useTelegramProfile } from "@/components/telegram-provider";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";

export default function ProfilePage() {
  const { profile, refreshProfile, haptic } = useTelegramProfile();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!profile) return null;

  async function sync() {
    setSyncing(true); setMessage(null); haptic("medium");
    try {
      const result = await apiFetch<{ uniqueImported: number; uniqueReceived: number; totalHosted: number; pagesFetched: number; assetsUpdated: number; virtualCreated: number }>("/api/gifts/sync", { method: "POST" });
      setMessage(`${result.uniqueImported}/${result.uniqueReceived} подарков синхронизировано · добавлено: ${result.virtualCreated} · обновлено: ${result.assetsUpdated} · страниц: ${result.pagesFetched}.`);
      await refreshProfile();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Синхронизация не удалась"); }
    finally { setSyncing(false); }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex items-center gap-3">
          {profile.photoUrl ? <img src={profile.photoUrl} alt="Профиль Telegram" className="h-14 w-14 rounded-2xl object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"><UserRound size={22} /></span>}
          <div className="min-w-0 flex-1"><h1 className="truncate text-lg font-semibold">{profile.firstName} {profile.lastName || ""}</h1><p className="text-xs text-[var(--muted)]">{profile.username ? `@${profile.username}` : `Telegram ${profile.telegramId}`}</p><span className="mt-1.5 inline-block rounded-xl bg-[var(--panel-2)] px-2 py-1 text-[10px] text-[var(--accent)]">{profile.tier}</span></div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Капитал" value={money(profile.netWorth)} /><Metric label="Доступно" value={money(profile.availableBalance)} /><Metric label="Подарки" value={money(profile.giftValue)} /><Metric label="Мемкоины" value={money(profile.coinValue)} /></div><div className="mt-2 rounded-2xl bg-[var(--surface)] p-3"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-2xl bg-[var(--panel-2)] text-[var(--accent)]"><Sparkles size={14} /></span><div><p className="text-xs font-medium">Уровень {profile.level}</p><p className="text-[9px] text-[var(--muted)]">{profile.xp} XP · {profile.xpForNextLevel} до следующего уровня</p></div></div><span className="text-[10px] text-[var(--muted)]">Активность рынка</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(profile.levelProgress * 100)}%` }} /></div></div>
        {profile.reservedBalance > 0 ? <div className="mt-2 flex items-center justify-between rounded-2xl bg-[var(--surface)] px-3 py-2 text-[10px]"><span className="flex items-center gap-1.5 text-[var(--muted)]"><LockKeyhole size={12} />Открытые офферы</span><span>{money(profile.reservedBalance)} в резерве</span></div> : null}
        <Link href={`/u/${profile.id}`} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--panel-2)] py-2.5 text-xs hover:bg-[var(--panel-3)]"><UserRound size={14} />Публичный профиль</Link>
      </section>

      <section className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="border-b border-[var(--border-soft)] px-3 py-3 text-sm font-medium">Подарки Telegram</div>
        <div className="p-3"><p className="text-xs leading-5 text-[var(--muted)]">Обновите коллекцию из Telegram. Названия, номера, свойства, редкость и медиа синхронизируются напрямую.</p><button onClick={sync} disabled={syncing} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] py-2.5 text-xs font-semibold text-black disabled:opacity-50"><RefreshCw size={14} className={syncing ? "animate-spin" : ""} />{syncing ? "Синхронизация…" : "Синхронизировать подарки"}</button>{message ? <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{message}</p> : null}<p className="mt-2 text-[10px] text-[var(--muted-2)]">Последняя успешная синхронизация: {profile.lastGiftSyncAt ? new Date(profile.lastGiftSyncAt).toLocaleString("ru-RU") : "никогда"}</p></div>
      </section>

      <section className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3 text-xs"><Row icon={<Trophy size={14} />} label="Статус" value={profile.tier} /><Row icon={<Sparkles size={14} />} label="Уровень" value={`${profile.level} · ${profile.xp} XP`} /><Row icon={<CalendarDays size={14} />} label="Регистрация" value={new Date(profile.joinedAt).toLocaleDateString("ru-RU")} /><Row icon={<Gift size={14} />} label="Подарок Telegram" value="Остаётся в Telegram" /></section>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-[var(--panel-2)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>; }
function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex items-center justify-between gap-3 border-b border-[var(--border-soft)] py-2.5 last:border-b-0"><span className="flex items-center gap-2 text-[var(--muted)]">{icon}{label}</span><span>{value}</span></div>; }
