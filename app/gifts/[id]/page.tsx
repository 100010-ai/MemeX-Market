"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ExternalLink, Gem, History, MessageSquareMore, ShoppingCart, Tag, TrendingUp, UserRound, X } from "lucide-react";
import { GiftMedia } from "@/components/gifts/gift-media";
import { CoinChart } from "@/components/coin-chart";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { PrimaryButton, SecondaryButton } from "@/components/ui";
import { useTelegramProfile } from "@/components/telegram-provider";
import { apiFetch } from "@/lib/api";
import { ago, money, percent } from "@/lib/format";
import type { Candle, GiftAsset, GiftCollection, GiftOffer, GiftTrade, GiftTraitStats } from "@/lib/types";

const realtimeTables = ["virtual_gifts", "gift_trades", "market_events"];
type DetailOffer = Pick<GiftOffer, "id" | "amount" | "status" | "createdAt" | "buyerId" | "buyerName"> & { isMine: boolean };
type Payload = { gift: GiftAsset; isOwner: boolean; balance: number; availableBalance: number; reservedBalance: number; trades: GiftTrade[]; candles: Candle[]; collection: GiftCollection; traitStats: GiftTraitStats; offers: DetailOffer[] };

type DetailTab = "activity" | "offers" | "chart";

export default function GiftPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<DetailTab>("activity");
  const [listingPrice, setListingPrice] = useState("");
  const [offerAmount, setOfferAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();

  const load = useCallback(async () => {
    try { setData(await apiFetch<Payload>(`/api/gifts/${id}`)); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load Gift"); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  const realtimeReload = useCallback(() => { void load(); }, [load]);

  async function run(key: string, task: () => Promise<unknown>) {
    setBusy(key); setError(null); haptic("medium");
    try { await task(); await Promise.all([load(), refreshProfile()]); haptic("heavy"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed"); }
    finally { setBusy(null); }
  }

  if (!data) return <div className="mx-auto max-w-5xl"><div className="mxm-skeleton h-[560px] rounded-lg" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  const { gift } = data;
  const myOffer = data.offers.find((offer) => offer.isMine);

  return (
    <div className="mx-auto max-w-5xl">
      <RealtimeRefresh channelName={`mxm-gift-${id}`} tables={realtimeTables} onChange={realtimeReload} />

      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/market" className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"><ArrowLeft size={17} /></Link>
        <a href={`https://t.me/nft/${encodeURIComponent(gift.telegramName)}`} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[11px] text-[var(--muted)]">Open in Telegram <ExternalLink size={12} /></a>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
        <section className="min-w-0">
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]"><GiftMedia gift={gift} className="aspect-square w-full" /></div>
          <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h1 className="truncate text-lg font-semibold">{gift.baseName}</h1><p className="mt-0.5 text-xs text-[var(--muted)]">#{gift.number} · {gift.telegramName}</p></div>{gift.isFromBlockchain ? <span className="rounded-md bg-[var(--panel-2)] px-2 py-1 text-[9px] text-[var(--muted)]">TON source</span> : null}</div>
            <Link href={`/u/${gift.ownerId}`} className="mt-3 flex items-center gap-2 rounded-lg bg-[var(--panel-2)] px-3 py-2.5"><UserRound size={14} className="text-[var(--muted)]" /><div className="min-w-0 flex-1"><p className="text-[10px] text-[var(--muted)]">Current MXM owner</p><p className="truncate text-xs font-medium">{gift.ownerName}</p></div></Link>
          </div>
        </section>

        <section className="min-w-0 space-y-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Listing" value={gift.listingPrice == null ? "—" : money(gift.listingPrice)} /><Metric label="Floor" value={data.traitStats.collectionFloor == null ? "—" : money(data.traitStats.collectionFloor)} /><Metric label="Best offer" value={gift.bestOffer == null ? "—" : money(gift.bestOffer)} /><Metric label="24h" value={percent(data.collection.change24h)} tone={data.collection.change24h} /></div>
            <div className="mt-3 grid grid-cols-3 gap-2"><SmallMetric label="24h volume" value={money(data.collection.volume24h)} /><SmallMetric label="Sales" value={String(data.collection.tradeCount24h)} /><SmallMetric label="Listed" value={String(data.collection.listedCount)} /></div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
            <Trait label="Collection" value={gift.baseName} rarity={null} floor={data.traitStats.collectionFloor} />
            <Trait label="Model" value={gift.modelName} rarity={gift.modelRarityPerMille} floor={data.traitStats.modelFloor} />
            <Trait label="Backdrop" value={gift.backdropName} rarity={gift.backdropRarityPerMille} floor={data.traitStats.backdropFloor} />
            <Trait label="Symbol" value={gift.symbolName} rarity={gift.symbolRarityPerMille} floor={data.traitStats.symbolFloor} />
          </div>

          {error ? <div className="rounded-lg border border-[#5a3035] bg-[#25191b] px-3 py-2.5 text-xs text-[#ff9aa4]">{error}</div> : null}

          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
            {gift.isBurned ? <div className="rounded-lg border border-[#5a3035] bg-[#25191b] px-3 py-3 text-xs text-[#ff9aa4]">Telegram marks this Gift as burned. MXM blocks new listings, offers and purchases for it.</div> : data.isOwner ? (
              <OwnerTradePanel gift={gift} listingPrice={listingPrice} setListingPrice={setListingPrice} busy={busy} onList={(price) => run("list", () => apiFetch(`/api/gifts/${id}/list`, { method: "POST", body: JSON.stringify({ price }) }))} onUnlist={() => run("unlist", () => apiFetch(`/api/gifts/${id}/list`, { method: "POST", body: JSON.stringify({ price: null }) }))} />
            ) : (
              <BuyerTradePanel gift={gift} availableBalance={data.availableBalance} reservedBalance={data.reservedBalance} offerAmount={offerAmount} setOfferAmount={setOfferAmount} myOffer={myOffer} busy={busy} onBuy={() => run("buy", () => apiFetch(`/api/gifts/${id}/buy`, { method: "POST" }))} onOffer={(amount) => run("offer", () => apiFetch(`/api/gifts/${id}/offer`, { method: "POST", body: JSON.stringify({ amount }) }))} onCancelOffer={myOffer ? () => run("cancel-offer", () => apiFetch(`/api/gifts/offers/${myOffer.id}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) })) : undefined} />
            )}
            <p className="mt-2 text-[10px] text-[var(--muted-2)]">Trading in MXM does not transfer the collectible in Telegram.</p>
          </div>

          <div className="grid grid-cols-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1">
            <TabButton active={tab === "activity"} onClick={() => setTab("activity")} icon={<History size={12} />} label="Activity" />
            <TabButton active={tab === "offers"} onClick={() => setTab("offers")} icon={<MessageSquareMore size={12} />} label={`Offers ${data.offers.length}`} />
            <TabButton active={tab === "chart"} onClick={() => setTab("chart")} icon={<TrendingUp size={12} />} label="Price" />
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
            {tab === "activity" ? <Activity trades={data.trades} /> : null}
            {tab === "offers" ? <Offers offers={data.offers} isOwner={data.isOwner} busy={busy} onAction={(offerId, action) => run(`${action}-${offerId}`, () => apiFetch(`/api/gifts/offers/${offerId}`, { method: "POST", body: JSON.stringify({ action }) }))} /> : null}
            {tab === "chart" ? <div className="p-3"><CoinChart candles={data.candles} height={300} baseFrame="1h" /></div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function OwnerTradePanel({ gift, listingPrice, setListingPrice, busy, onList, onUnlist }: { gift: GiftAsset; listingPrice: string; setListingPrice: (value: string) => void; busy: string | null; onList: (price: number) => void; onUnlist: () => void }) {
  const parsed = Number(listingPrice);
  return <><div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium">Your listing</p>{gift.listingPrice != null ? <span className="flex items-center gap-1 text-xs"><Gem size={12} fill="currentColor" />{money(gift.listingPrice).replace("$", "")}</span> : <span className="text-[11px] text-[var(--muted)]">Not listed</span>}</div><div className="flex gap-2"><input value={listingPrice} onChange={(event) => setListingPrice(event.target.value)} inputMode="decimal" placeholder={gift.listingPrice == null ? "Price" : String(gift.listingPrice)} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[#555960]" /><PrimaryButton disabled={busy !== null || !Number.isFinite(parsed) || parsed <= 0} onClick={() => onList(parsed)}><Tag size={14} className="mr-1 inline" />{busy === "list" ? "…" : gift.status === "listed" ? "Update" : "List"}</PrimaryButton></div>{gift.status === "listed" ? <SecondaryButton className="mt-2 w-full" disabled={busy !== null} onClick={onUnlist}>Remove listing</SecondaryButton> : null}</>;
}

function BuyerTradePanel({ gift, availableBalance, reservedBalance, offerAmount, setOfferAmount, myOffer, busy, onBuy, onOffer, onCancelOffer }: { gift: GiftAsset; availableBalance: number; reservedBalance: number; offerAmount: string; setOfferAmount: (value: string) => void; myOffer?: DetailOffer; busy: string | null; onBuy: () => void; onOffer: (amount: number) => void; onCancelOffer?: () => void }) {
  const parsed = Number(offerAmount);
  return <><div className="mb-2 flex items-center justify-between text-[10px] text-[var(--muted)]"><span>Available {money(availableBalance)}</span>{reservedBalance > 0 ? <span>{money(reservedBalance)} reserved</span> : null}</div>{gift.status === "listed" && gift.listingPrice != null ? <PrimaryButton className="flex w-full items-center justify-center gap-2 py-3" disabled={busy !== null || availableBalance + (myOffer?.amount || 0) < gift.listingPrice} onClick={onBuy}><ShoppingCart size={16} />{busy === "buy" ? "Buying…" : <span className="flex items-center gap-1">Buy <Gem size={13} fill="currentColor" />{money(gift.listingPrice).replace("$", "")}</span>}</PrimaryButton> : <div className="rounded-lg bg-[var(--panel-2)] px-3 py-2.5 text-center text-xs text-[var(--muted)]">Not listed</div>}<div className="mt-2 flex gap-2"><input value={offerAmount} onChange={(event) => setOfferAmount(event.target.value)} inputMode="decimal" placeholder={myOffer ? `Current ${myOffer.amount}` : "Offer amount"} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none" /><SecondaryButton disabled={busy !== null || !Number.isFinite(parsed) || parsed <= 0 || parsed > availableBalance + (myOffer?.amount || 0)} onClick={() => onOffer(parsed)}>{myOffer ? "Update" : "Offer"}</SecondaryButton></div>{myOffer && onCancelOffer ? <button disabled={busy !== null} onClick={onCancelOffer} className="mt-2 w-full rounded-lg bg-[var(--panel-2)] py-2 text-[11px] text-[var(--muted)]">Cancel my offer · {money(myOffer.amount)}</button> : null}</>;
}

function Trait({ label, value, rarity, floor }: { label: string; value: string; rarity: number | null; floor: number | null }) { return <div className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--border-soft)] px-3 py-3 text-xs last:border-b-0"><span className="text-[var(--muted)]">{label}</span><div className="min-w-0"><p className="truncate text-white">{value}</p>{floor != null ? <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--muted)]">floor <Gem size={9} fill="currentColor" />{money(floor).replace("$", "")}</p> : null}</div>{rarity == null ? <span /> : <span className="rounded bg-[#37320d] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">{(rarity / 10).toFixed(rarity % 10 ? 1 : 0)}%</span>}</div>; }
function Metric({ label, value, tone }: { label: string; value: string; tone?: number }) { return <div className="rounded-lg bg-[var(--panel-2)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className={`mt-1 truncate text-xs font-semibold ${tone == null ? "" : tone >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{value}</p></div>; }
function SmallMetric({ label, value }: { label: string; value: string }) { return <div><p className="text-[9px] text-[var(--muted)]">{label}</p><p className="mt-0.5 text-xs">{value}</p></div>; }
function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) { return <button onClick={onClick} className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-[11px] ${active ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}>{icon}{label}</button>; }

function Offers({ offers, isOwner, busy, onAction }: { offers: DetailOffer[]; isOwner: boolean; busy: string | null; onAction: (id: string, action: "accept" | "reject" | "cancel") => void }) {
  if (!offers.length) return <Empty text="No open offers" />;
  return <div className="divide-y divide-[var(--border-soft)]">{offers.map((offer) => <div key={offer.id} className="p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-medium">{offer.buyerName}{offer.isMine ? <span className="ml-1.5 text-[9px] text-[var(--accent)]">YOU</span> : null}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{ago(offer.createdAt)}</p></div><p className="flex items-center gap-1 text-sm font-semibold"><Gem size={12} fill="currentColor" />{money(offer.amount).replace("$", "")}</p></div>{isOwner ? <div className="mt-2 grid grid-cols-2 gap-2"><button disabled={busy !== null} onClick={() => onAction(offer.id, "reject")} className="flex items-center justify-center gap-1 rounded-lg bg-[var(--panel-2)] py-2 text-xs"><X size={13} />Reject</button><button disabled={busy !== null} onClick={() => onAction(offer.id, "accept")} className="flex items-center justify-center gap-1 rounded-lg bg-[var(--accent)] py-2 text-xs font-semibold text-black"><Check size={13} />Accept</button></div> : offer.isMine ? <button disabled={busy !== null} onClick={() => onAction(offer.id, "cancel")} className="mt-2 w-full rounded-lg bg-[var(--panel-2)] py-2 text-xs text-[var(--muted)]">Cancel</button> : null}</div>)}</div>;
}

function Activity({ trades }: { trades: GiftTrade[] }) { if (!trades.length) return <Empty text="No completed sales yet" />; return <div className="divide-y divide-[var(--border-soft)]">{trades.map((trade) => <div key={trade.id} className="flex items-center justify-between gap-3 px-3 py-3"><div className="min-w-0"><p className="truncate text-xs"><span className="text-[var(--muted)]">{trade.sellerName || "—"}</span> → <span>{trade.buyerName}</span></p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{ago(trade.createdAt)}</p></div><p className="flex items-center gap-1 text-xs font-medium"><Gem size={11} fill="currentColor" />{money(trade.price).replace("$", "")}</p></div>)}</div>; }
function Empty({ text }: { text: string }) { return <div className="grid min-h-28 place-items-center px-4 text-center text-xs text-[var(--muted)]">{text}</div>; }
