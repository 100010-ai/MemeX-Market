"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Clock3, ExternalLink, ShoppingCart, Tag, X } from "lucide-react";
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
  const [tab, setTab] = useState<"details" | "offers" | "activity" | "chart">("details");
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

  if (!data) return <div className="mx-auto max-w-4xl"><div className="mxm-skeleton h-[420px] rounded-xl" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  const { gift } = data;

  return (
    <div className="mx-auto max-w-5xl">
      <RealtimeRefresh channelName={`mxm-gift-${id}`} tables={realtimeTables} onChange={realtimeReload} />
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/market" className="flex items-center gap-2 text-xs text-[var(--muted)] hover:text-white"><ArrowLeft size={15} />Market</Link>
        <a href={`https://t.me/nft/${encodeURIComponent(gift.telegramName)}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] hover:text-white">Telegram source <ExternalLink size={12} /></a>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <GiftMedia gift={gift} className="aspect-square w-full" />
          <div className="p-3">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h1 className="truncate text-lg font-semibold">{gift.baseName}</h1><p className="mt-0.5 text-xs text-[var(--muted)]">#{gift.number} · {gift.telegramName}</p></div><span className={`rounded-md px-2 py-1 text-[10px] ${gift.status === "listed" ? "bg-[rgba(255,214,0,.12)] text-[var(--accent)]" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}>{gift.status === "listed" ? "LISTED" : "OWNED"}</span></div>
            <Link href={`/u/${gift.ownerId}`} className="mt-3 flex items-center justify-between rounded-lg bg-[var(--panel-2)] px-3 py-2.5 text-xs"><span className="text-[var(--muted)]">Virtual owner</span><span>{gift.ownerName}</span></Link>
          </div>
        </section>

        <section className="min-w-0">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Listing" value={gift.listingPrice == null ? "—" : money(gift.listingPrice)} />
            <Stat label="Est. value" value={gift.estimatedValue == null ? "—" : money(gift.estimatedValue)} />
            <Stat label="Collection floor" value={data.traitStats.collectionFloor == null ? "—" : money(data.traitStats.collectionFloor)} />
            <Stat label="24h" value={data.collection ? percent(data.collection.change24h) : "—"} tone={data.collection?.change24h} />
          </div>

          <div className="mt-3 grid grid-cols-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1">
            {(["details", "offers", "activity", "chart"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-lg py-2 text-[11px] capitalize ${tab === item ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}>{item}</button>)}
          </div>

          <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)]">
            {tab === "details" ? <Details gift={gift} stats={data.traitStats} /> : null}
            {tab === "offers" ? <Offers offers={data.offers} isOwner={data.isOwner} busy={busy} onAction={(offerId, action) => run(`${action}-${offerId}`, () => apiFetch(`/api/gifts/offers/${offerId}`, { method: "POST", body: JSON.stringify({ action }) }))} /> : null}
            {tab === "activity" ? <Activity trades={data.trades} /> : null}
            {tab === "chart" ? <div className="p-3"><CoinChart candles={data.candles} height={300} baseFrame="1h" /></div> : null}
          </div>

          {error ? <div className="mt-3 rounded-lg border border-[#5a3035] bg-[#25191b] px-3 py-2.5 text-xs text-[#ff9aa4]">{error}</div> : null}

          <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
            {data.isOwner ? (
              <>
                <p className="mb-2 text-xs font-medium">Manage listing</p>
                <div className="flex gap-2"><input value={listingPrice} onChange={(e) => setListingPrice(e.target.value)} inputMode="decimal" placeholder={gift.listingPrice == null ? "Price" : String(gift.listingPrice)} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[#555960]" /><PrimaryButton disabled={busy !== null || !Number(listingPrice)} onClick={() => run("list", () => apiFetch(`/api/gifts/${id}/list`, { method: "POST", body: JSON.stringify({ price: Number(listingPrice) }) }))}><Tag size={14} className="mr-1 inline" />{busy === "list" ? "…" : gift.status === "listed" ? "Update" : "List"}</PrimaryButton></div>
                {gift.status === "listed" ? <SecondaryButton className="mt-2 w-full" disabled={busy !== null} onClick={() => run("unlist", () => apiFetch(`/api/gifts/${id}/list`, { method: "POST", body: JSON.stringify({ price: null }) }))}>Remove listing</SecondaryButton> : null}
              </>
            ) : (
              <>
                {gift.status === "listed" && gift.listingPrice != null ? <PrimaryButton className="flex w-full items-center justify-center gap-2 py-3" disabled={busy !== null || data.balance < gift.listingPrice} onClick={() => run("buy", () => apiFetch(`/api/gifts/${id}/buy`, { method: "POST" }))}><ShoppingCart size={16} />{busy === "buy" ? "Buying…" : `Buy ${money(gift.listingPrice)}`}</PrimaryButton> : <div className="rounded-lg bg-[var(--panel-2)] px-3 py-2.5 text-center text-xs text-[var(--muted)]">This Gift is not listed.</div>}
                <div className="mt-2 flex gap-2"><input value={offerAmount} onChange={(e) => setOfferAmount(e.target.value)} inputMode="decimal" placeholder="Offer amount" className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none" /><SecondaryButton disabled={busy !== null || !Number(offerAmount)} onClick={() => run("offer", () => apiFetch(`/api/gifts/${id}/offer`, { method: "POST", body: JSON.stringify({ amount: Number(offerAmount) }) }))}>Offer</SecondaryButton></div>
              </>
            )}
            <p className="mt-2 text-[10px] text-[var(--muted)]">MXM ownership and money are simulated. The Telegram collectible itself is never transferred by this trade.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Details({ gift, stats }: { gift: GiftAsset; stats: GiftTraitStats }) {
  return <div className="divide-y divide-[var(--border-soft)]"><Trait label="Collection" value={gift.baseName} rarity={null} floor={stats.collectionFloor} /><Trait label="Model" value={gift.modelName} rarity={gift.modelRarityPerMille} floor={stats.modelFloor} /><Trait label="Backdrop" value={gift.backdropName} rarity={gift.backdropRarityPerMille} floor={stats.backdropFloor} /><Trait label="Symbol" value={gift.symbolName} rarity={gift.symbolRarityPerMille} floor={stats.symbolFloor} /></div>;
}
function Trait({ label, value, rarity, floor }: { label: string; value: string; rarity: number | null; floor: number | null }) { return <div className="grid grid-cols-[82px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-3 text-xs"><span className="text-[var(--muted)]">{label}</span><div className="min-w-0"><p className="truncate">{value}</p>{floor != null ? <p className="mt-0.5 text-[10px] text-[var(--muted)]">Floor {money(floor)}</p> : null}</div><span className="text-[10px] text-[var(--accent)]">{rarity == null ? "" : `${(rarity / 10).toFixed(rarity % 10 ? 1 : 0)}%`}</span></div>; }
function Offers({ offers, isOwner, busy, onAction }: { offers: DetailOffer[]; isOwner: boolean; busy: string | null; onAction: (id: string, action: "accept" | "reject" | "cancel") => void }) { return offers.length ? <div className="divide-y divide-[var(--border-soft)]">{offers.map((offer) => <div key={offer.id} className="flex items-center gap-3 px-3 py-3"><div className="min-w-0 flex-1"><Link href={`/u/${offer.buyerId}`} className="truncate text-xs hover:underline">{offer.buyerName}</Link><p className="mt-1 text-sm font-semibold">{money(offer.amount)}</p><p className="text-[10px] text-[var(--muted)]">{ago(offer.createdAt)}</p></div>{isOwner ? <div className="flex gap-1"><button disabled={busy !== null} onClick={() => onAction(offer.id, "reject")} className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--panel-2)] text-[var(--negative)]"><X size={15} /></button><button disabled={busy !== null} onClick={() => onAction(offer.id, "accept")} className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--accent)] text-black"><Check size={15} /></button></div> : null}</div>)}</div> : <EmptyLine text="No active offers" />; }
function Activity({ trades }: { trades: GiftTrade[] }) { return trades.length ? <div className="divide-y divide-[var(--border-soft)]">{trades.map((trade) => <div key={trade.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3"><div className="min-w-0 text-xs"><Link href={`/u/${trade.buyerId}`} className="hover:underline">{trade.buyerName}</Link><span className="text-[var(--muted)]"> bought from </span>{trade.sellerId ? <Link href={`/u/${trade.sellerId}`} className="hover:underline">{trade.sellerName}</Link> : <span>{trade.sellerName || "—"}</span>}</div><div className="text-right"><p className="text-xs font-medium">{money(trade.price)}</p><p className="text-[10px] text-[var(--muted)]">{ago(trade.createdAt)}</p></div></div>)}</div> : <EmptyLine text="No completed sales yet" />; }
function EmptyLine({ text }: { text: string }) { return <div className="grid min-h-36 place-items-center text-xs text-[var(--muted)]"><span className="flex items-center gap-2"><Clock3 size={14} />{text}</span></div>; }
function Stat({ label, value, tone }: { label: string; value: string; tone?: number }) { return <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className={`mt-1 truncate text-sm font-semibold ${tone == null ? "" : tone >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{value}</p></div>; }
