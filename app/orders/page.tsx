"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Gem, Inbox, Tag, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { GiftAsset, GiftOffer } from "@/lib/types";
import { ago, money } from "@/lib/format";
import { useTelegramProfile } from "@/components/telegram-provider";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { GiftMedia } from "@/components/gifts/gift-media";

const realtimeTables = ["virtual_gifts", "gift_offers"];
type Payload = { outgoing: GiftOffer[]; incoming: GiftOffer[]; listings: GiftAsset[] };

export default function OrdersPage() {
  const [data, setData] = useState<Payload>({ outgoing: [], incoming: [], listings: [] });
  const [tab, setTab] = useState<"incoming" | "outgoing" | "listings">("incoming");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { profile, refreshProfile, haptic } = useTelegramProfile();
  const load = useCallback(async () => { setData(await apiFetch<Payload>("/api/orders", { cacheMs: 2_000 })); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void load()
        .catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить заявки"))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const realtimeReload = useCallback(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось обновить заявки")); }, [load]);

  async function act(id: string, action: "accept" | "reject" | "cancel") {
    setBusy(id + action); setError(null); haptic("medium");
    try { await apiFetch(`/api/gifts/offers/${id}`, { method: "POST", body: JSON.stringify({ action }) }); await Promise.all([load(), refreshProfile()]); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось выполнить действие"); }
    finally { setBusy(null); }
  }


  async function unlist(id: string) {
    setBusy(id + "unlist"); setError(null); haptic("medium");
    try { await apiFetch(`/api/gifts/${id}/list`, { method: "POST", body: JSON.stringify({ price: null }) }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось снять лот"); }
    finally { setBusy(null); }
  }

  const current = tab === "incoming" ? data.incoming : data.outgoing;
  return (
    <div className="mx-auto max-w-3xl">
      <RealtimeRefresh
        channelName="mxm-orders"
        tables={realtimeTables}
        filters={profile?.id ? { virtual_gifts: `owner_profile_id=eq.${profile.id}` } : undefined}
        onChange={realtimeReload}
        debounceMs={1000}
      />

      <div className="mb-3 flex items-end justify-between gap-3"><div><h1 className="text-[15px] font-semibold tracking-[-.02em]">Заявки и лоты</h1><p className="mt-1 text-[10px] text-[var(--muted)]">Предложения и активные лоты</p></div></div>
      <div className="mxm-segment mb-3">
        <Tab label="Входящие" count={data.incoming.length} active={tab === "incoming"} onClick={() => setTab("incoming")} />
        <Tab label="Исходящие" count={data.outgoing.length} active={tab === "outgoing"} onClick={() => setTab("outgoing")} />
        <Tab label="Лоты" count={data.listings.length} active={tab === "listings"} onClick={() => setTab("listings")} />
      </div>

      {error ? <div className="mb-3 mxm-alert mxm-alert-error flex items-center justify-between gap-3"><span>{error}</span><button type="button" onClick={() => { setLoading(true); setError(null); void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить заявки")).finally(() => setLoading(false)); }} className="shrink-0 underline">Повторить</button></div> : null}

      {loading ? <div className="space-y-2"><div className="mxm-skeleton h-16 rounded-2xl" /><div className="mxm-skeleton h-16 rounded-2xl" /><div className="mxm-skeleton h-16 rounded-2xl" /></div> : tab === "listings" ? (
        data.listings.length ? <div className="divide-y divide-[var(--border-soft)] border-y border-[var(--border-soft)]">{data.listings.map((gift) => <div key={gift.virtualGiftId} className="grid grid-cols-[46px_minmax(0,1fr)_auto] items-center gap-2.5 py-3"><Link href={`/gifts/${gift.virtualGiftId}`}><GiftMedia gift={gift} compact className="h-[46px] w-[46px] rounded-[14px]" /></Link><div className="min-w-0"><Link href={`/gifts/${gift.virtualGiftId}`} className="truncate text-xs font-medium">{gift.baseName}</Link><p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">#{gift.number} · {gift.modelName}</p></div><div className="flex items-center gap-2"><span className="flex items-center gap-1 text-xs font-medium"><Gem size={11} fill="currentColor" />{gift.listingPrice == null ? "—" : money(gift.listingPrice)}</span><button disabled={busy !== null} onClick={() => void unlist(gift.virtualGiftId)} aria-label="Снять с продажи" className="mxm-icon-action"><X size={14}/></button></div></div>)}</div> : <Empty text="Нет активных лотов" icon={<Tag />} />
      ) : current.length ? (
        <div className="mxm-card overflow-hidden px-3">{current.map((offer) => <div key={offer.id} className="border-b border-[var(--border-soft)] py-2.5"><div className="grid grid-cols-[46px_minmax(0,1fr)_auto] items-center gap-2.5"><Link href={`/gifts/${offer.virtualGiftId}`}><GiftMedia gift={offer.gift} compact className="h-[46px] w-[46px] rounded-2xl" /></Link><div className="min-w-0"><Link href={`/gifts/${offer.virtualGiftId}`} className="block truncate text-xs font-medium">{offer.baseName} #{offer.number}</Link><p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{tab === "incoming" ? `от ${offer.buyerName}` : `владелец ${offer.ownerName}`} · {ago(offer.createdAt)}{offer.expiresAt ? ` · до ${new Date(offer.expiresAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}` : ""}</p></div><p className="flex items-center gap-1 text-xs font-semibold"><Gem size={11} fill="currentColor" />{money(offer.amount)}</p></div><div className="mt-2 flex gap-2">{tab === "incoming" ? <><button disabled={busy !== null} onClick={() => act(offer.id, "reject")} className="flex-1 rounded-[13px] border border-[var(--border)] bg-[var(--panel-2)] py-2.5 text-[10px]">Отклонить</button><button disabled={busy !== null} onClick={() => act(offer.id, "accept")} className="flex-1 rounded-[13px] bg-[var(--accent)] py-2.5 text-[10px] font-semibold text-[#0b0d10]">Принять</button></> : <button disabled={busy !== null} onClick={() => act(offer.id, "cancel")} className="w-full rounded-[13px] border border-[var(--border)] bg-[var(--panel-2)] py-2.5 text-[10px]">Отменить предложение</button>}</div></div>)}</div>
      ) : <Empty text={tab === "incoming" ? "Входящих предложений нет" : "Исходящих предложений нет"} icon={<Inbox />} />}
    </div>
  );
}
function Tab({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) { return <button onClick={onClick} className={`mxm-segment-button ${active ? "is-active" : ""}`}><span>{label}</span><span className={`shrink-0 text-[9px] ${active ? "text-white" : "text-[var(--muted-2)]"}`}>{count}</span></button>; }
function Empty({ text, icon }: { text: string; icon: React.ReactNode }) { return <div className="mxm-card p-8 text-center text-[var(--muted)]"><div className="mx-auto flex w-fit opacity-60">{icon}</div><p className="mt-3 text-xs">{text}</p></div>; }
