"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, ExternalLink, Gem, ShoppingCart, Tag, X } from "lucide-react";
import { GiftMedia } from "@/components/gifts/gift-media";
import { CoinChart } from "@/components/coin-chart";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { PrimaryButton, SecondaryButton } from "@/components/ui";
import { useTelegramProfile } from "@/components/telegram-provider";
import { apiFetch } from "@/lib/api";
import { ago, money, percent } from "@/lib/format";
import type { Candle, GiftAsset, GiftCollection, GiftOffer, GiftTrade, GiftTraitStats } from "@/lib/types";

const realtimeTables = ["virtual_gifts", "gift_trades"];
type DetailOffer = Pick<GiftOffer, "id" | "amount" | "status" | "createdAt" | "buyerId" | "buyerName">;
type Payload = { gift: GiftAsset; isOwner: boolean; balance: number; trades: GiftTrade[]; candles: Candle[]; collection: GiftCollection | null; traitStats: GiftTraitStats; offers: DetailOffer[] };

export default function GiftPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<"offers" | "activity" | "chart">("offers");
  const [listingPrice, setListingPrice] = useState("");
  const [offerAmount, setOfferAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();

  const load = useCallback(async () => {
    try { setData(await apiFetch<Payload>(`/api/gifts/${id}`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load Gift"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const realtimeReload = useCallback(() => { void load(); }, [load]);

  async function run(key: string, task: () => Promise<unknown>) {
    setBusy(key); setError(null); haptic("medium");
    try { await task(); await Promise.all([load(), refreshProfile()]); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(null); }
  }

  if (!data) return <div className="mx-auto max-w-4xl"><div className="mxm-skeleton h-[520px] rounded-lg" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  const { gift } = data;

  return (
    <div className="mx-auto max-w-4xl">
      <RealtimeRefresh channelName={`mxm-gift-${id}`} tables={realtimeTables} onChange={realtimeReload} />

      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/market" className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"><ArrowLeft size={17} /></Link>
        <a href={`https://t.me/nft/${encodeURIComponent(gift.telegramName)}`} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[11px] text-[var(--muted)]">Telegram <ExternalLink size={12} /></a>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <GiftMedia gift={gift} className="aspect-square w-full" />
          <div className="p-3">
            <h1 className="truncate text-lg font-semibold">{gift.baseName}</h1>
            <div className="mt-0.5 flex items-center justify-between gap-2"><p className="text-xs text-[var(--muted)]">#{gift.number}</p><Link href={`/u/${gift.ownerId}`} className="truncate text-[11px] text-[var(--muted)] hover:text-white">{gift.ownerName}</Link></div>
            <div className="mt-3 grid grid-cols-2 gap-2"><MiniStat label="Floor" value={data.traitStats.collectionFloor == null ? "—" : money(data.traitStats.collectionFloor)} /><MiniStat label="24h" value={data.collection ? percent(data.collection.change24h) : "—"} tone={data.collection?.change24h} /></div>
          </div>
        </section>

        <section className="min-w-0 space-y-3">
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
            <Trait label="Collection" value={gift.baseName} rarity={null} floor={data.traitStats.collectionFloor} />
            <Trait label="Model" value={gift.modelName} rarity={gift.modelRarityPerMille} floor={data.traitStats.modelFloor} />
            <Trait label="Backdrop" value={gift.backdropName} rarity={gift.backdropRarityPerMille} floor={data.traitStats.backdropFloor} />
            <Trait label="Symbol" value={gift.symbolName} rarity={gift.symbolRarityPerMille} floor={data.traitStats.symbolFloor} />
          </div>

          {error ? <div className="rounded-lg border border-[#5a3035] bg-[#25191b] px-3 py-2.5 text-xs text-[#ff9aa4]">{error}</div> : null}

          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
            {data.isOwner ? (
              <>
                <div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium">Listing</p>{gift.listingPrice != null ? <span className="flex items-center gap-1 text-xs"><Gem size={12} fill="currentColor" />{money(gift.listingPrice).replace("$", "")}</span> : <span className="text-[11px] text-[var(--muted)]">Not listed</span>}</div>
                <div className="flex gap-2"><input value={listingPrice} onChange={(e) => setListingPrice(e.target.value)} inputMode="decimal" placeholder={gift.listingPrice == null ? "Price" : String(gift.listingPrice)} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[#555960]" /><PrimaryButton disabled={busy !== null || !Number(listingPrice)} onClick={() => run("list", () => apiFetch(`/api/gifts/${id}/list`, { method: "POST", body: JSON.stringify({ price: Number(listingPrice) }) }))}><Tag size={14} className="mr-1 inline" />{busy === "list" ? "…" : gift.status === "listed" ? "Update" : "List"}</PrimaryButton></div>
                {gift.status === "listed" ? <SecondaryButton className="mt-2 w-full" disabled={busy !== null} onClick={() => run("unlist", () => apiFetch(`/api/gifts/${id}/list`, { method: "POST", body: JSON.stringify({ price: null }) }))}>Remove listing</SecondaryButton> : null}
              </>
            ) : (
              <>
                {gift.status === "listed" && gift.listingPrice != null ? <PrimaryButton className="flex w-full items-center justify-center gap-2 py-3" disabled={busy !== null || data.balance < gift.listingPrice} onClick={() => run("buy", () => apiFetch(`/api/gifts/${id}/buy`, { method: "POST" }))}><ShoppingCart size={16} />{busy === "buy" ? "Buying…" : <span className="flex items-center gap-1">Buy <Gem size={13} fill="currentColor" />{money(gift.listingPrice).replace("$", "")}</span>}</PrimaryButton> : <div className="rounded-lg bg-[var(--panel-2)] px-3 py-2.5 text-center text-xs text-[var(--muted)]">Not listed</div>}
                <div className="mt-2 flex gap-2"><input value={offerAmount} onChange={(e) => setOfferAmount(e.target.value)} inputMode="decimal" placeholder="Offer amount" className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none" /><SecondaryButton disabled={busy !== null || !Number(offerAmount)} onClick={() => run("offer", () => apiFetch(`/api/gifts/${id}/offer`, { method: "POST", body: JSON.stringify({ amount: Number(offerAmount) }) }))}>Offer</SecondaryButton></div>
              </>
            )}
            <p className="mt-2 text-[10px] text-[var(--muted-2)]">MXM trades do not transfer the Telegram collectible.</p>
          </div>

          <div className="grid grid-cols-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1">
            {(["offers", "activity", "chart"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-md py-2 text-[11px] capitalize ${tab === item ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}>{item}</button>)}
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)]">
            {tab === "offers" ? <Offers offers={data.offers} isOwner={data.isOwner} busy={busy} onAction={(offerId, action) => run(`${action}-${offerId}`, () => apiFetch(`/api/gifts/offers/${offerId}`, { method: "POST", body: JSON.stringify({ action }) }))} /> : null}
            {tab === "activity" ? <Activity trades={data.trades} /> : null}
            {tab === "chart" ? <div className="p-3"><CoinChart candles={data.candles} height={280} baseFrame="1h" /></div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function Trait({ label, value, rarity, floor }: { label: string; value: string; rarity: number | null; floor: number | null }) {
  return <div className="grid grid-cols-[78px_minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--border-soft)] px-3 py-3 text-xs last:border-b-0"><span className="text-[var(--muted)]">{label}</span><div className="min-w-0"><p className="truncate text-white">{value}</p>{floor != null ? <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--muted)]">floor <Gem size={9} fill="currentColor" />{money(floor).replace("$", "")}</p> : null}</div><span className="rounded bg-[#37320d] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">{rarity == null ? "" : `${(rarity / 10).toFixed(rarity % 10 ? 1 : 0)}%`}</span></div>;
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: number }) { return <div className="rounded-lg bg-[var(--panel-2)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className={`mt-1 truncate text-xs font-medium ${tone == null ? "" : tone >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{value}</p></div>; }

function Offers({ offers, isOwner, busy, onAction }: { offers: DetailOffer[]; isOwner: boolean; busy: string | null; onAction: (id: string, action: "accept" | "reject" | "cancel") => void }) {
  if (!offers.length) return <Empty text="No open offers" />;
  return <div className="divide-y divide-[var(--border-soft)]">{offers.map((offer) => <div key={offer.id} className="p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-medium">{offer.buyerName}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{ago(offer.createdAt)}</p></div><p className="flex items-center gap-1 text-sm font-semibold"><Gem size={12} fill="currentColor" />{money(offer.amount).replace("$", "")}</p></div>{isOwner ? <div className="mt-2 grid grid-cols-2 gap-2"><button disabled={busy !== null} onClick={() => onAction(offer.id, "reject")} className="flex items-center justify-center gap-1 rounded-lg bg-[var(--panel-2)] py-2 text-xs"><X size={13} />Reject</button><button disabled={busy !== null} onClick={() => onAction(offer.id, "accept")} className="flex items-center justify-center gap-1 rounded-lg bg-[var(--accent)] py-2 text-xs font-semibold text-black"><Check size={13} />Accept</button></div> : null}</div>)}</div>;
}

function Activity({ trades }: { trades: GiftTrade[] }) {
  if (!trades.length) return <Empty text="No completed sales" />;
  return <div className="divide-y divide-[var(--border-soft)]">{trades.map((trade) => <div key={trade.id} className="flex items-center justify-between gap-3 px-3 py-3"><div className="min-w-0"><p className="truncate text-xs"><span className="text-[var(--muted)]">{trade.sellerName || "—"}</span> → <span>{trade.buyerName}</span></p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{ago(trade.createdAt)}</p></div><p className="flex items-center gap-1 text-xs font-medium"><Gem size={11} fill="currentColor" />{money(trade.price).replace("$", "")}</p></div>)}</div>;
}
function Empty({ text }: { text: string }) { return <div className="grid min-h-28 place-items-center px-4 text-center text-xs text-[var(--muted)]">{text}</div>; }
