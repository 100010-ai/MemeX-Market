"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Gem, Inbox, Tag } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { GiftAsset, GiftOffer } from "@/lib/types";
import { ago, money } from "@/lib/format";
import { useTelegramProfile } from "@/components/telegram-provider";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { GiftMedia } from "@/components/gifts/gift-media";

const realtimeTables = ["virtual_gifts", "gift_trades", "market_events"];
type Payload = { outgoing: GiftOffer[]; incoming: GiftOffer[]; listings: GiftAsset[] };

export default function OrdersPage() {
  const [data, setData] = useState<Payload>({ outgoing: [], incoming: [], listings: [] });
  const [tab, setTab] = useState<"incoming" | "outgoing" | "listings">("incoming");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();
  const load = useCallback(async () => { setData(await apiFetch<Payload>("/api/orders")); }, []);
  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить ордера")); }, [load]);
  const realtimeReload = useCallback(() => { void load(); }, [load]);

  async function act(id: string, action: "accept" | "reject" | "cancel") {
    setBusy(id + action); setError(null); haptic("medium");
    try { await apiFetch(`/api/gifts/offers/${id}`, { method: "POST", body: JSON.stringify({ action }) }); await Promise.all([load(), refreshProfile()]); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось выполнить действие"); }
    finally { setBusy(null); }
  }

  const current = tab === "incoming" ? data.incoming : data.outgoing;
  return (
    <div className="mx-auto max-w-3xl">
      <RealtimeRefresh channelName="mxm-orders" tables={realtimeTables} onChange={realtimeReload} />

      <div className="mxm-hscroll mb-3 flex flex-nowrap gap-1 rounded-[20px] border border-[var(--border)] bg-[var(--panel)] p-1">
        <Tab label="Входящие офферы" count={data.incoming.length} active={tab === "incoming"} onClick={() => setTab("incoming")} />
        <Tab label="Мои офферы" count={data.outgoing.length} active={tab === "outgoing"} onClick={() => setTab("outgoing")} />
        <Tab label="Мои лоты" count={data.listings.length} active={tab === "listings"} onClick={() => setTab("listings")} />
      </div>

      {error ? <div className="mb-3 rounded-2xl border border-[#5a3035] bg-[#25191b] px-3 py-2 text-xs text-[#ff9aa4]">{error}</div> : null}

      {tab === "listings" ? (
        data.listings.length ? <div className="space-y-1.5">{data.listings.map((gift) => <Link key={gift.virtualGiftId} href={`/gifts/${gift.virtualGiftId}`} className="grid grid-cols-[46px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-2 active:bg-[var(--panel-2)]"><GiftMedia gift={gift} compact className="h-[46px] w-[46px] rounded-2xl" /><div className="min-w-0"><p className="truncate text-xs font-medium">{gift.baseName}</p><p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">#{gift.number} · {gift.modelName}</p></div><div className="flex items-center gap-1 text-xs font-medium"><Gem size={11} fill="currentColor" />{gift.listingPrice == null ? "—" : money(gift.listingPrice).replace("$", "")}</div></Link>)}</div> : <Empty text="Нет активных лотов" icon={<Tag />} />
      ) : current.length ? (
        <div className="space-y-1.5">{current.map((offer) => <div key={offer.id} className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-2.5"><div className="grid grid-cols-[46px_minmax(0,1fr)_auto] items-center gap-2.5"><Link href={`/gifts/${offer.virtualGiftId}`}><GiftMedia gift={offer.gift} compact className="h-[46px] w-[46px] rounded-2xl" /></Link><div className="min-w-0"><Link href={`/gifts/${offer.virtualGiftId}`} className="block truncate text-xs font-medium">{offer.baseName} #{offer.number}</Link><p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{tab === "incoming" ? `от ${offer.buyerName}` : `владелец ${offer.ownerName}`} · {ago(offer.createdAt)}</p></div><p className="flex items-center gap-1 text-xs font-semibold"><Gem size={11} fill="currentColor" />{money(offer.amount).replace("$", "")}</p></div><div className="mt-2 flex gap-2">{tab === "incoming" ? <><button disabled={busy !== null} onClick={() => act(offer.id, "reject")} className="flex-1 rounded-2xl bg-[var(--panel-2)] py-2 text-xs">Отклонить</button><button disabled={busy !== null} onClick={() => act(offer.id, "accept")} className="flex-1 rounded-[17px] bg-[var(--accent)] py-2 text-xs font-semibold text-black">Принять</button></> : <button disabled={busy !== null} onClick={() => act(offer.id, "cancel")} className="w-full rounded-2xl bg-[var(--panel-2)] py-2 text-xs">Отменить оффер</button>}</div></div>)}</div>
      ) : <Empty text={tab === "incoming" ? "Входящих офферов нет" : "Активных офферов нет"} icon={<Inbox />} />}
    </div>
  );
}
function Tab({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) { return <button onClick={onClick} className={`flex h-9 shrink-0 items-center justify-center gap-1 rounded-[16px] px-3 text-[10px] whitespace-nowrap ${active ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}><span>{label}</span><span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] ${active ? "bg-white/8" : "bg-[var(--surface)] text-[var(--muted-2)]"}`}>{count}</span></button>; }
function Empty({ text, icon }: { text: string; icon: React.ReactNode }) { return <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center text-[var(--muted)]"><div className="mx-auto flex w-fit opacity-60">{icon}</div><p className="mt-3 text-xs">{text}</p></div>; }
