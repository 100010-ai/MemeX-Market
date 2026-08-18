"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Inbox, Tag } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { GiftAsset, GiftOffer } from "@/lib/types";
import { ago, money } from "@/lib/format";
import { useTelegramProfile } from "@/components/telegram-provider";
import { RealtimeRefresh } from "@/components/realtime-refresh";

const realtimeTables = ["virtual_gifts", "gift_trades"];
type Payload = { outgoing: GiftOffer[]; incoming: GiftOffer[]; listings: GiftAsset[] };

export default function OrdersPage() {
  const [data, setData] = useState<Payload>({ outgoing: [], incoming: [], listings: [] });
  const [tab, setTab] = useState<"incoming" | "outgoing" | "listings">("incoming");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();
  const load = useCallback(async () => { setData(await apiFetch<Payload>("/api/orders")); }, []);
  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : "Could not load orders")); }, [load]);
  const realtimeReload = useCallback(() => { void load(); }, [load]);

  async function act(id: string, action: "accept" | "reject" | "cancel") {
    setBusy(id + action); setError(null); haptic("medium");
    try { await apiFetch(`/api/gifts/offers/${id}`, { method: "POST", body: JSON.stringify({ action }) }); await Promise.all([load(), refreshProfile()]); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(null); }
  }

  const current = tab === "incoming" ? data.incoming : data.outgoing;
  return (
    <div className="mx-auto max-w-3xl">
      <RealtimeRefresh channelName="mxm-orders" tables={realtimeTables} onChange={realtimeReload} />
      <div className="mb-3 flex items-center justify-between"><div><h1 className="text-lg font-semibold">Orders</h1><p className="text-xs text-[var(--muted)]">Gift offers and active listings.</p></div><span className="rounded-lg bg-[var(--panel-2)] px-2.5 py-1.5 text-xs text-[var(--muted)]">{data.incoming.length + data.outgoing.length} open</span></div>
      <div className="mb-3 grid grid-cols-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1"><Tab label="Incoming" active={tab === "incoming"} onClick={() => setTab("incoming")} /><Tab label="My offers" active={tab === "outgoing"} onClick={() => setTab("outgoing")} /><Tab label="Listings" active={tab === "listings"} onClick={() => setTab("listings")} /></div>
      {error ? <div className="mb-3 rounded-lg border border-[#5a3035] bg-[#25191b] px-3 py-2 text-xs text-[#ff9aa4]">{error}</div> : null}
      {tab === "listings" ? data.listings.length ? <div className="space-y-2">{data.listings.map((gift) => <Link key={gift.virtualGiftId} href={`/gifts/${gift.virtualGiftId}`} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 hover:bg-[var(--panel-2)]"><div className="min-w-0"><p className="truncate text-sm font-medium">{gift.baseName} <span className="text-[var(--muted)]">#{gift.number}</span></p><p className="mt-0.5 text-[11px] text-[var(--muted)]">{gift.modelName} · {gift.backdropName}</p></div><div className="shrink-0 text-right"><p className="text-xs text-[var(--accent)]">{gift.listingPrice == null ? "—" : money(gift.listingPrice)}</p><p className="text-[10px] text-[var(--muted)]">listed</p></div></Link>)}</div> : <Empty text="No active listings" icon={<Tag />} /> : current.length ? <div className="space-y-2">{current.map((offer) => <div key={offer.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><Link href={`/gifts/${offer.virtualGiftId}`} className="truncate text-sm font-medium hover:underline">{offer.baseName} #{offer.number}</Link><p className="mt-0.5 text-[11px] text-[var(--muted)]">{tab === "incoming" ? `from ${offer.buyerName}` : `owner ${offer.ownerName}`} · {ago(offer.createdAt)}</p></div><p className="text-sm font-semibold"><span className="mr-1 text-[var(--accent)]">◆</span>{money(offer.amount).replace("$", "")}</p></div><div className="mt-3 flex gap-2">{tab === "incoming" ? <><button disabled={busy !== null} onClick={() => act(offer.id, "reject")} className="flex-1 rounded-lg bg-[var(--panel-2)] py-2 text-xs">Reject</button><button disabled={busy !== null} onClick={() => act(offer.id, "accept")} className="flex-1 rounded-lg bg-[var(--accent)] py-2 text-xs font-semibold text-black">Accept</button></> : <button disabled={busy !== null} onClick={() => act(offer.id, "cancel")} className="w-full rounded-lg bg-[var(--panel-2)] py-2 text-xs">Cancel offer</button>}</div></div>)}</div> : <Empty text={tab === "incoming" ? "No incoming offers" : "No open offers"} icon={<Inbox />} />}
    </div>
  );
}
function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <button onClick={onClick} className={`rounded-lg py-2 text-xs ${active ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}>{label}</button>; }
function Empty({ text, icon }: { text: string; icon: React.ReactNode }) { return <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-12 text-center text-[var(--muted)]"><div className="mx-auto flex w-fit opacity-60">{icon}</div><p className="mt-3 text-sm">{text}</p></div>; }
