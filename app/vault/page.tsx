"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, RefreshCw, WalletCards } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { GiftAsset, Holding, Profile } from "@/lib/types";
import { compact, money, percent, price } from "@/lib/format";
import { CoinAvatar, PrimaryButton } from "@/components/ui";
import { GiftCard } from "@/components/gifts/gift-card";
import { useTelegramProfile } from "@/components/telegram-provider";

type Payload = { holdings: Holding[]; gifts: GiftAsset[]; profile: Profile };

export default function VaultPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<"gifts" | "coins" | "listed">("gifts");
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();
  async function load() { setData(await apiFetch<Payload>("/api/portfolio")); }
  useEffect(() => { load().catch((e) => setMessage(e instanceof Error ? e.message : "Could not load vault")); }, []);

  async function sync() {
    setSyncing(true); setMessage(null); haptic("medium");
    try { const r = await apiFetch<{ uniqueImported: number }>("/api/gifts/sync", { method: "POST" }); setMessage(`Imported ${r.uniqueImported} unique Telegram Gifts`); await Promise.all([load(), refreshProfile()]); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Sync failed"); }
    finally { setSyncing(false); }
  }

  const listed = useMemo(() => data?.gifts.filter((g) => g.status === "listed") || [], [data]);
  if (!data) return <div className="mx-auto max-w-5xl rounded-xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center text-sm text-[var(--muted)]">{message || "Loading vault…"}</div>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Metric label="Net worth" value={money(data.profile.netWorth)} />
        <Metric label="Gifts" value={money(data.profile.giftValue)} />
        <Metric label="Coins" value={money(data.profile.coinValue)} />
      </div>
      <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3"><div className="flex min-w-0 items-center gap-2"><Boxes size={17} /><div><h1 className="text-sm font-semibold">Vault</h1><p className="text-[11px] text-[var(--muted)]">Virtual assets linked to your Telegram profile.</p></div></div><button onClick={sync} disabled={syncing} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--panel-2)] px-3 py-2 text-xs"><RefreshCw size={13} className={syncing ? "animate-spin" : ""} />{syncing ? "Syncing" : "Sync gifts"}</button></div>
      {message ? <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--muted)]">{message}</div> : null}
      <div className="mb-3 grid grid-cols-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1"><Tab label={`Gifts (${data.gifts.length})`} active={tab === "gifts"} onClick={() => setTab("gifts")} /><Tab label={`Coins (${data.holdings.length})`} active={tab === "coins"} onClick={() => setTab("coins")} /><Tab label={`Listed (${listed.length})`} active={tab === "listed"} onClick={() => setTab("listed")} /></div>
      {tab === "gifts" || tab === "listed" ? (
        (tab === "listed" ? listed : data.gifts).length ? <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">{(tab === "listed" ? listed : data.gifts).map((gift) => <GiftCard key={gift.virtualGiftId} gift={gift} />)}</div> : <Empty title={tab === "listed" ? "No gifts on sale" : "No virtual gifts yet"} action={tab === "gifts" ? <PrimaryButton onClick={sync} disabled={syncing}>Sync Telegram Gifts</PrimaryButton> : undefined} />
      ) : (
        data.holdings.length ? <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]"><div className="divide-y divide-[var(--border-soft)]">{data.holdings.map((h) => <a href={`/coin/${h.coinId}`} key={h.coinId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 hover:bg-[var(--panel-2)] sm:grid-cols-[minmax(0,1fr)_1fr_1fr]"><div className="flex min-w-0 items-center gap-2.5"><CoinAvatar symbol={h.symbol} /><div className="min-w-0"><p className="truncate text-sm font-medium">{h.name}</p><p className="text-[11px] text-[var(--muted)]">{compact(h.quantity)} {h.symbol}</p></div></div><div className="text-right sm:text-left"><p className="text-xs">{money(h.marketValue)}</p><p className={`text-[10px] ${h.pnl >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{percent(h.costBasis ? h.pnl / h.costBasis * 100 : 0)}</p></div><div className="hidden sm:block"><p className="text-[10px] text-[var(--muted)]">Current</p><p className="text-xs">{price(h.currentPrice)}</p></div></a>)}</div></div> : <Empty title="No meme-coin positions" />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>; }
function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <button onClick={onClick} className={`rounded-md py-2 text-xs ${active ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}>{label}</button>; }
function Empty({ title, action }: { title: string; action?: React.ReactNode }) { return <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-10 text-center"><WalletCards className="mx-auto text-[var(--muted-2)]" /><p className="mt-3 text-sm font-medium">{title}</p><p className="mt-1 text-xs text-[var(--muted)]">Your assets will appear here.</p>{action ? <div className="mt-4">{action}</div> : null}</div>; }
