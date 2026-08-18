"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, History, Info, Tag } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Candle, GiftAsset, GiftTrade } from "@/lib/types";
import { ago, money } from "@/lib/format";
import { GiftMedia } from "@/components/gifts/gift-media";
import { CoinChart } from "@/components/coin-chart";
import { PrimaryButton, SecondaryButton } from "@/components/ui";
import { useTelegramProfile } from "@/components/telegram-provider";

type Offer = { id: string; amount: number; status: string; createdAt: string; buyerId: string; buyerName: string };
type Payload = {
  gift: GiftAsset;
  isOwner: boolean;
  balance: number;
  trades: GiftTrade[];
  candles: Candle[];
  offers: Offer[];
  collection: null | { floorPrice: number | null; lastSalePrice: number | null; volume24h: number; change24h: number; listedCount: number };
};

export default function GiftPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [offerInput, setOfferInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();

  async function load() { setData(await apiFetch<Payload>(`/api/gifts/${id}`)); }
  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : "Could not load gift")); }, [id]);
  const gift = data?.gift;

  async function action(name: string, fn: () => Promise<unknown>) {
    setBusy(name); setError(null); haptic("medium");
    try { await fn(); await Promise.all([load(), refreshProfile()]); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed"); haptic("heavy"); }
    finally { setBusy(null); }
  }

  if (!data || !gift) return <div className="mx-auto max-w-4xl rounded-xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center text-sm text-[var(--muted)]">{error || "Loading virtual gift…"}</div>;
  const displayPrice = gift.listingPrice ?? gift.lastSalePrice ?? gift.referencePrice;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-white"><ArrowLeft size={17} /> Back</button>
        {gift.telegramName ? <a href={`https://t.me/nft/${gift.telegramName}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-white">Telegram reference <ExternalLink size={13} /></a> : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <GiftMedia gift={gift} className="aspect-square w-full" />
          <div className="p-3">
            <div className="flex items-start justify-between gap-3"><div><h1 className="text-lg font-semibold">{gift.baseName}</h1><p className="mt-0.5 text-sm text-[var(--muted)]">#{gift.number}</p></div><div className="rounded-md bg-[var(--panel-2)] px-2 py-1 text-[10px] text-[var(--muted)]">SIMULATED</div></div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Metric label="Virtual price" value={money(displayPrice)} />
              <Metric label="Reference" value={money(gift.referencePrice)} />
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--muted)]"><Info size={13} /> This trade never transfers the real Telegram collectible.</div>
          </div>
        </section>

        <div className="space-y-3">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
            <h2 className="mb-2 text-sm font-medium">Traits</h2>
            <Trait label="Collection" value={gift.baseName} side={data.collection?.floorPrice ? `floor ${money(data.collection.floorPrice)}` : "no floor"} />
            <Trait label="Model" value={gift.modelName} side={gift.modelRarity ? gift.modelRarity : `${gift.modelRarityPerMille / 10}%`} accent={gift.modelRarityPerMille > 0 && gift.modelRarityPerMille <= 30} />
            <Trait label="Backdrop" value={gift.backdropName} side={`${gift.backdropRarityPerMille / 10}%`} accent={gift.backdropRarityPerMille <= 30} />
            <Trait label="Symbol" value={gift.symbolName} side={`${gift.symbolRarityPerMille / 10}%`} accent={gift.symbolRarityPerMille <= 30} />
            <Trait label="Number" value={`#${gift.number}`} side={gift.number <= 1000 ? "low number" : "standard"} accent={gift.number <= 1000} />
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-medium">Collection market</h2><span className="text-[10px] text-[var(--muted)]">{gift.baseName}</span></div>
            {data.collection ? <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Floor" value={data.collection.floorPrice ? money(data.collection.floorPrice) : "—"} /><Metric label="Last sale" value={data.collection.lastSalePrice ? money(data.collection.lastSalePrice) : "—"} /><Metric label="24h volume" value={money(data.collection.volume24h)} /><Metric label="Listed" value={String(data.collection.listedCount)} /></div> : null}
            <CoinChart candles={data.candles} height={240} showTimeframes={false} />
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
            {data.isOwner ? (
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Tag size={15} /> Your virtual gift</div>
                <div className="flex gap-2"><input value={priceInput} onChange={(e) => setPriceInput(e.target.value)} inputMode="decimal" placeholder={gift.listingPrice ? String(gift.listingPrice) : "Listing price"} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[#565a61]" /><PrimaryButton disabled={busy !== null || !Number(priceInput)} onClick={() => action("list", () => apiFetch(`/api/gifts/${id}/list`, { method: "POST", body: JSON.stringify({ price: Number(priceInput) }) }))}>{busy === "list" ? "…" : gift.status === "listed" ? "Update" : "List"}</PrimaryButton></div>
                {gift.status === "listed" ? <SecondaryButton disabled={busy !== null} onClick={() => action("cancel-list", () => apiFetch(`/api/gifts/${id}/list`, { method: "POST", body: JSON.stringify({ price: null }) }))} className="mt-2 w-full">Remove listing</SecondaryButton> : null}
                {data.offers.length ? <div className="mt-3 border-t border-[var(--border-soft)] pt-3"><p className="mb-2 text-xs text-[var(--muted)]">Open offers</p>{data.offers.map((o) => <div key={o.id} className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-[var(--panel-2)] p-2.5"><div><p className="text-xs">{o.buyerName}</p><p className="text-[11px] text-[var(--accent)]">{money(o.amount)}</p></div><div className="flex gap-1.5"><button disabled={busy !== null} onClick={() => action(`reject-${o.id}`, () => apiFetch(`/api/gifts/offers/${o.id}`, { method: "POST", body: JSON.stringify({ action: "reject" }) }))} className="rounded-md bg-[var(--panel-3)] px-2.5 py-1.5 text-[11px]">Reject</button><button disabled={busy !== null} onClick={() => action(`accept-${o.id}`, () => apiFetch(`/api/gifts/offers/${o.id}`, { method: "POST", body: JSON.stringify({ action: "accept" }) }))} className="rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-semibold text-black">Accept</button></div></div>)}</div> : null}
              </div>
            ) : (
              <div>
                <div className="mb-3 flex items-end justify-between gap-3"><div><p className="text-[11px] text-[var(--muted)]">Available balance</p><p className="text-sm font-medium">{money(data.balance)}</p></div><div className="text-right"><p className="text-[11px] text-[var(--muted)]">Virtual price</p><p className="text-lg font-semibold"><span className="mr-1 text-[var(--accent)]">◆</span>{money(displayPrice).replace("$", "")}</p></div></div>
                {gift.status === "listed" ? <PrimaryButton className="w-full py-3" disabled={busy !== null} onClick={() => action("buy", async () => { await apiFetch(`/api/gifts/${id}/buy`, { method: "POST" }); haptic("heavy"); })}>{busy === "buy" ? "Buying…" : `Buy for ${money(gift.listingPrice || 0)}`}</PrimaryButton> : <div className="rounded-lg bg-[var(--panel-2)] p-3 text-center text-xs text-[var(--muted)]">Not currently listed</div>}
                {gift.ownerId ? <div className="mt-2 flex gap-2"><input value={offerInput} onChange={(e) => setOfferInput(e.target.value)} inputMode="decimal" placeholder="Offer amount" className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none" /><SecondaryButton disabled={busy !== null || !Number(offerInput)} onClick={() => action("offer", () => apiFetch(`/api/gifts/${id}/offer`, { method: "POST", body: JSON.stringify({ amount: Number(offerInput) }) }))}>Offer</SecondaryButton></div> : null}
              </div>
            )}
            {error ? <p className="mt-2 text-xs text-[var(--negative)]">{error}</p> : null}
          </section>
        </div>
      </div>

      <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3 py-3 text-sm font-medium"><History size={15} /> Virtual ownership activity</div>
        {data.trades.length ? <div className="divide-y divide-[var(--border-soft)]">{data.trades.map((t) => <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs">{t.buyerName} bought from {t.sellerName || "market inventory"}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{ago(t.createdAt)} ago</p></div><p className="text-xs font-medium">{money(t.price)}</p></div>)}</div> : <div className="px-3 py-5 text-center text-xs text-[var(--muted)]">No player-to-player sales yet.</div>}
      </section>
    </div>
  );
}

function Trait({ label, value, side, accent = false }: { label: string; value: string; side: string; accent?: boolean }) {
  return <div className="mb-1.5 grid grid-cols-[82px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg bg-[var(--panel-2)] px-3 py-2.5 text-xs"><span className="text-[var(--muted)]">{label}</span><span className="truncate text-right sm:text-left">{value}</span><span className={`rounded px-1.5 py-0.5 text-[10px] ${accent ? "bg-[rgba(255,216,61,.12)] text-[var(--accent)]" : "text-[var(--muted)]"}`}>{side}</span></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-[var(--panel-2)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}
