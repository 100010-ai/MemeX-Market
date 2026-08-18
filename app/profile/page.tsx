"use client";

import { useState } from "react";
import { CalendarDays, CircleDollarSign, Gift, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { useTelegramProfile } from "@/components/telegram-provider";
import { apiFetch } from "@/lib/api";
import { money, percent } from "@/lib/format";

export default function ProfilePage() {
  const { profile, refreshProfile, haptic } = useTelegramProfile();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!profile) return null;
  async function sync() {
    setSyncing(true); setMessage(null); haptic("medium");
    try { const r = await apiFetch<{ uniqueImported: number; totalHosted: number }>("/api/gifts/sync", { method: "POST" }); setMessage(`Imported ${r.uniqueImported} unique gifts (${r.totalHosted} hosted gifts scanned).`); await refreshProfile(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Sync failed"); }
    finally { setSyncing(false); }
  }
  return (
    <div className="mx-auto max-w-2xl">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex items-center gap-3">{profile.photoUrl ? <img src={profile.photoUrl} alt="Telegram avatar" className="h-14 w-14 rounded-xl object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded-xl bg-[var(--panel-2)] text-xl font-semibold">{profile.firstName.slice(0,1).toUpperCase()}</span>}<div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h1 className="truncate text-lg font-semibold">{profile.firstName} {profile.lastName || ""}</h1><ShieldCheck size={16} className="shrink-0 text-[var(--blue)]" /></div><p className="text-xs text-[var(--muted)]">{profile.username ? `@${profile.username}` : `Telegram ${profile.telegramId}`}</p><span className="mt-1.5 inline-block rounded-md bg-[var(--panel-2)] px-2 py-1 text-[10px] text-[var(--accent)]">{profile.tier}</span></div></div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Net worth" value={money(profile.netWorth)} /><Metric label="Cash" value={money(profile.balance)} /><Metric label="Gift value" value={money(profile.giftValue)} /><Metric label="Coin value" value={money(profile.coinValue)} /></div>
        <div className="mt-2 rounded-lg bg-[var(--panel-2)] p-3"><div className="flex items-center justify-between text-xs"><span className="text-[var(--muted)]">PnL from $100 start</span><span className={profile.pnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>{money(profile.pnl)} · {percent(profile.pnl)}</span></div></div>
      </section>

      <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="border-b border-[var(--border-soft)] px-3 py-3 text-sm font-medium">Telegram sync</div>
        <div className="p-3"><p className="text-xs leading-5 text-[var(--muted)]">MemeX reads your hosted Telegram collectible metadata through the bot and creates separate virtual replicas. Selling a replica here never transfers or lists the real Telegram gift.</p><button onClick={sync} disabled={syncing} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] py-2.5 text-xs font-semibold text-black disabled:opacity-50"><RefreshCw size={14} className={syncing ? "animate-spin" : ""} />{syncing ? "Syncing gifts…" : "Sync Telegram Gifts"}</button>{message ? <p className="mt-2 text-xs text-[var(--muted)]">{message}</p> : null}<p className="mt-2 text-[10px] text-[var(--muted-2)]">Last sync: {profile.lastGiftSyncAt ? new Date(profile.lastGiftSyncAt).toLocaleString() : "never"}</p></div>
      </section>

      <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 text-xs"><Row icon={<UserRound size={14} />} label="Telegram ID" value={String(profile.telegramId)} /><Row icon={<CalendarDays size={14} />} label="Joined" value={new Date(profile.joinedAt).toLocaleDateString()} /><Row icon={<CircleDollarSign size={14} />} label="Starting virtual cash" value="$100" /><Row icon={<Gift size={14} />} label="Real asset custody" value="Never transferred" /></section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-[var(--panel-2)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>; }
function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex items-center justify-between gap-3 border-b border-[var(--border-soft)] py-2.5 last:border-b-0"><span className="flex items-center gap-2 text-[var(--muted)]">{icon}{label}</span><span>{value}</span></div>; }
