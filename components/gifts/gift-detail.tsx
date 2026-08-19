"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Clock3,
  ExternalLink,
  Gem,
  History,
  MessageSquareMore,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Tag,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";
import { GiftMedia } from "@/components/gifts/gift-media";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { PrimaryButton, SecondaryButton } from "@/components/ui";
import { useTelegramProfile } from "@/components/telegram-provider";
import { apiFetch } from "@/lib/api";
import { ago, money, percent } from "@/lib/format";
import type { Candle, GiftActivity, GiftAsset, GiftCollection, GiftOffer, GiftTraitStats } from "@/lib/types";

const realtimeTables = ["virtual_gifts", "gift_trades", "gift_offers", "gift_listing_events", "market_events"];
const CoinChart = dynamic(() => import("@/components/coin-chart").then((module) => module.CoinChart), {
  ssr: false,
  loading: () => <div className="mxm-skeleton h-[260px] rounded-[14px]" />,
});
type DetailOffer = Pick<GiftOffer, "id" | "amount" | "status" | "createdAt" | "buyerId" | "buyerName"> & { isMine: boolean; expiresAt: string | null };
type Payload = {
  gift: GiftAsset;
  resolvedVirtualGiftId?: string;
  isOwner: boolean;
  inCart: boolean;
  itemStats: { tradeCount: number; volume: number; highSale: number | null; lowSale: number | null };
  balance: number;
  availableBalance: number;
  reservedBalance: number;
  candles: Candle[];
  collection: GiftCollection;
  traitStats: GiftTraitStats;
  offers: DetailOffer[];
  activity: GiftActivity[];
};

type DetailTab = "activity" | "offers" | "chart";

function makeRequestKey(prefix: string) {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${id}`;
}

function timeUntil(value: string | null) {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "истёк";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours} ч`;
  return `${Math.ceil(hours / 24)} дн`;
}

function priceBasisLabel(gift: GiftAsset) {
  switch (gift.priceBasis) {
    case "mxm_listing": return "MXM-листинг";
    case "tonapi_listing": return "TON-листинг";
    case "item_last_sale": return "Последняя продажа";
    case "collection_last_sale": return "Продажа коллекции";
    default: return "Нет цены";
  }
}

export function GiftDetail({ id, onClose }: { id: string; onClose?: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<DetailTab>("activity");
  const [listingPrice, setListingPrice] = useState("");
  const [listingDays, setListingDays] = useState(7);
  const [offerAmount, setOfferAmount] = useState("");
  const [offerHours, setOfferHours] = useState(72);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const loadSequence = useRef(0);
  const buyRequestKey = useRef<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const payload = await apiFetch<Payload>(`/api/gifts/${encodeURIComponent(id)}`);
      if (sequence !== loadSequence.current) return;
      setData(payload);
      setError(null);
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить подарок");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setData(null);
    setError(null);
    setChartLoading(false);
    buyRequestKey.current = null;
    void load();
    return () => { loadSequence.current += 1; };
  }, [load]);

  const realtimeReload = useCallback(() => { void load(); }, [load]);

  async function openTab(nextTab: DetailTab) {
    setTab(nextTab);
    if (nextTab !== "chart" || !data || data.candles.length || chartLoading) return;
    setChartLoading(true);
    try {
      const chart = await apiFetch<{ candles: Candle[] }>(`/api/gifts/${encodeURIComponent(data.resolvedVirtualGiftId || id)}/candles`, { cacheMs: 10_000 });
      setData((current) => current ? { ...current, candles: chart.candles } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "График недоступен");
    } finally {
      setChartLoading(false);
    }
  }

  async function run(key: string, task: () => Promise<unknown>) {
    if (busy) return;
    setBusy(key);
    setError(null);
    haptic("medium");
    try {
      await task();
      await Promise.all([load(), refreshProfile()]);
      haptic("heavy");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие");
    } finally {
      setBusy(null);
    }
  }

  if (!data && error) return (
    <div>
      <div className="mb-3 flex items-center">
        {onClose ? (
          <button onClick={onClose} aria-label="Закрыть" className="grid h-9 w-9 place-items-center rounded-[18px] border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"><X size={17} /></button>
        ) : (
          <Link href="/market" className="grid h-9 w-9 place-items-center rounded-[18px] border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"><ArrowLeft size={17} /></Link>
        )}
      </div>
      <div className="rounded-[18px] border border-[#5a3035] bg-[#181012] px-4 py-5">
        <p className="text-sm font-medium text-white">Не удалось открыть NFT</p>
        <p className="mt-1.5 text-xs leading-5 text-[#ff9aa4]">{error}</p>
        <button type="button" disabled={loading} onClick={() => void load()} className="mt-4 inline-flex h-9 items-center gap-2 rounded-[17px] bg-[var(--panel-3)] px-3 text-xs font-medium text-white disabled:opacity-50"><RefreshCw size={13} className={loading ? "animate-spin" : ""} />Повторить</button>
      </div>
    </div>
  );

  if (!data) return <div className="mxm-skeleton h-[min(62dvh,460px)] rounded-[16px]" />;

  const { gift } = data;
  const canonicalGiftId = data.resolvedVirtualGiftId || gift.virtualGiftId;
  const myOffer = data.offers.find((offer) => offer.isMine);
  const expiry = timeUntil(gift.listingExpiresAt);
  const premiumToFloor = gift.listingPrice != null && data.traitStats.collectionFloor && data.traitStats.collectionFloor > 0
    ? ((gift.listingPrice / data.traitStats.collectionFloor) - 1) * 100
    : null;

  return (
    <div>
      <RealtimeRefresh channelName={`mxm-gift-${canonicalGiftId}`} tables={realtimeTables} onChange={realtimeReload} />

      <div className="mb-3 flex items-center justify-between gap-3">
        {onClose ? (
          <button onClick={onClose} aria-label="Закрыть" className="grid h-9 w-9 place-items-center rounded-[18px] border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"><X size={17} /></button>
        ) : (
          <Link href="/market" className="grid h-9 w-9 place-items-center rounded-[18px] border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"><ArrowLeft size={17} /></Link>
        )}
        <a href={gift.telegramName.startsWith("ton:") ? `https://tonviewer.com/${encodeURIComponent(gift.telegramName.slice(4))}` : `https://t.me/nft/${encodeURIComponent(gift.telegramName)}`} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-1.5 rounded-[18px] border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[11px] text-[var(--muted)]">{gift.telegramName.startsWith("ton:") ? "TON" : "Telegram"} <ExternalLink size={12} /></a>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
        <section className="min-w-0">
          <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)]"><GiftMedia gift={gift} className="aspect-square w-full" /></div>
          <div className="mt-3 rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold">{gift.baseName}</h1>
                <p className="mt-0.5 text-xs text-[var(--muted)]">#{gift.number} · {gift.telegramName}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {gift.chainVerified ? <span title="TON NFT подтверждён" className="grid h-6 w-6 place-items-center rounded-full bg-[rgba(76,189,126,.12)] text-[var(--positive)]"><ShieldCheck size={13} /></span> : null}
                {gift.isFromBlockchain ? <span className="rounded-[18px] bg-[var(--panel-2)] px-2 py-1 text-[9px] text-[var(--muted)]">TON</span> : null}
              </div>
            </div>
            <Link href={`/u/${gift.ownerId}`} className="mt-3 flex items-center gap-2 rounded-[18px] bg-[var(--panel-2)] px-3 py-2.5"><UserRound size={14} className="text-[var(--muted)]" /><div className="min-w-0 flex-1"><p className="text-[10px] text-[var(--muted)]">Владелец</p><p className="truncate text-xs font-medium">{gift.ownerName}</p></div></Link>
          </div>
        </section>

        <section className="min-w-0 space-y-3">
          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Metric label="Листинг" value={gift.listingPrice == null ? "—" : money(gift.listingPrice)} />
              <Metric label="Флор" value={data.traitStats.collectionFloor == null ? "—" : money(data.traitStats.collectionFloor)} />
              <Metric label="Ориентир" value={gift.referencePrice == null ? "—" : money(gift.referencePrice)} />
              <Metric label="Оффер" value={gift.bestOffer == null ? "—" : money(gift.bestOffer)} />
              <Metric label="24h" value={percent(data.collection.change24h)} tone={data.collection.change24h} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              <SmallMetric label="Объём предмета" value={money(data.itemStats.volume)} />
              <SmallMetric label="Сделки" value={String(data.itemStats.tradeCount)} />
              <SmallMetric label="Макс. продажа" value={data.itemStats.highSale == null ? "—" : money(data.itemStats.highSale)} />
              <SmallMetric label="Volume 7d" value={money(data.collection.volume7d)} />
              <SmallMetric label="Sales 7d" value={String(data.collection.tradeCount7d)} />
              <SmallMetric label="В листинге" value={`${data.collection.listedPct.toFixed(1)}%`} />
            </div>
          </div>

          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">Источник цены</p>
                <p className="mt-1 text-xs font-medium">{priceBasisLabel(gift)}</p>
              </div>
              {gift.referencePrice != null ? <p className="flex items-center gap-1 text-sm font-semibold"><Gem size={12} fill="currentColor" />{money(gift.referencePrice)}</p> : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--muted)]">
              {gift.externalPriceSource ? <span>Источник: {gift.externalPriceSource}</span> : null}
              {gift.externalPriceSeenAt ? <span>Обновлено {ago(gift.externalPriceSeenAt)}</span> : null}
              {premiumToFloor != null ? <span className={premiumToFloor <= 0 ? "text-[var(--positive)]" : ""}>{premiumToFloor >= 0 ? "+" : ""}{premiumToFloor.toFixed(1)}% к floor</span> : null}
              {gift.status === "listed" && expiry ? <span className="inline-flex items-center gap-1"><Clock3 size={10} />{expiry}</span> : null}
            </div>
          </div>

          <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)]">
            <Link href={`/collections/${encodeURIComponent(gift.baseName)}`} className="block"><Trait label="Коллекция" value={gift.baseName} rarity={null} floor={data.traitStats.collectionFloor} /></Link>
            <Trait label="Модель" value={gift.modelName} rarity={gift.modelRarityPerMille} floor={data.traitStats.modelFloor} />
            <Trait label="Фон" value={gift.backdropName} rarity={gift.backdropRarityPerMille} floor={data.traitStats.backdropFloor} />
            <Trait label="Символ" value={gift.symbolName} rarity={gift.symbolRarityPerMille} floor={data.traitStats.symbolFloor} />
          </div>

          {error ? <div className="rounded-[18px] border border-[#5a3035] bg-[#25191b] px-3 py-2.5 text-xs text-[#ff9aa4]">{error}</div> : null}

          <div className="rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-3">
            {gift.isBurned ? (
              <div className="rounded-[18px] border border-[#5a3035] bg-[#25191b] px-3 py-3 text-xs text-[#ff9aa4]">Telegram пометил этот подарок как сожжённый. В MXM для него отключены продажа, офферы и покупки.</div>
            ) : data.isOwner ? (
              <OwnerTradePanel
                gift={gift}
                listingPrice={listingPrice}
                setListingPrice={setListingPrice}
                listingDays={listingDays}
                setListingDays={setListingDays}
                busy={busy}
                onList={(price) => run("list", () => apiFetch(`/api/gifts/${encodeURIComponent(canonicalGiftId)}/list`, { method: "POST", body: JSON.stringify({ price, durationDays: listingDays }) }))}
                onUnlist={() => run("unlist", () => apiFetch(`/api/gifts/${encodeURIComponent(canonicalGiftId)}/list`, { method: "POST", body: JSON.stringify({ price: null }) }))}
              />
            ) : (
              <BuyerTradePanel
                gift={gift}
                inCart={data.inCart}
                availableBalance={data.availableBalance}
                reservedBalance={data.reservedBalance}
                offerAmount={offerAmount}
                setOfferAmount={setOfferAmount}
                offerHours={offerHours}
                setOfferHours={setOfferHours}
                myOffer={myOffer}
                busy={busy}
                onBuy={() => {
                  buyRequestKey.current ||= makeRequestKey(`gift:${canonicalGiftId}`);
                  void run("buy", async () => {
                    await apiFetch(`/api/gifts/${encodeURIComponent(canonicalGiftId)}/buy`, { method: "POST", headers: { "x-idempotency-key": buyRequestKey.current! } });
                    buyRequestKey.current = null;
                  });
                }}
                onCart={() => run("cart", () => apiFetch("/api/cart", { method: "POST", body: JSON.stringify({ action: data.inCart ? "remove" : "add", virtualGiftId: canonicalGiftId }) }))}
                onOffer={(amount) => run("offer", () => apiFetch(`/api/gifts/${encodeURIComponent(canonicalGiftId)}/offer`, { method: "POST", body: JSON.stringify({ amount, durationHours: offerHours }) }))}
                onCancelOffer={myOffer ? () => run("cancel-offer", () => apiFetch(`/api/gifts/offers/${myOffer.id}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) })) : undefined}
              />
            )}
            <p className="mt-2 text-[10px] text-[var(--muted-2)]">Только MXM: Telegram Gift не переводится.</p>
          </div>

          <div className="mxm-hscroll gap-1 rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-1">
            <TabButton active={tab === "activity"} onClick={() => void openTab("activity")} icon={<History size={12} />} label="История" />
            <TabButton active={tab === "offers"} onClick={() => void openTab("offers")} icon={<MessageSquareMore size={12} />} label={`Офферы · ${data.offers.length}`} />
            <TabButton active={tab === "chart"} onClick={() => void openTab("chart")} icon={<TrendingUp size={12} />} label="Цена" />
          </div>

          <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)]">
            {tab === "activity" ? <Activity activity={data.activity} /> : null}
            {tab === "offers" ? <Offers offers={data.offers} isOwner={data.isOwner} busy={busy} onAction={(offerId, action) => run(`${action}-${offerId}`, () => apiFetch(`/api/gifts/offers/${offerId}`, { method: "POST", body: JSON.stringify({ action }) }))} /> : null}
            {tab === "chart" ? <div className="p-3">{chartLoading && !data.candles.length ? <div className="mxm-skeleton h-[260px] rounded-[14px]" /> : <CoinChart candles={data.candles} height={280} baseFrame="1h" />}</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function OwnerTradePanel({ gift, listingPrice, setListingPrice, listingDays, setListingDays, busy, onList, onUnlist }: { gift: GiftAsset; listingPrice: string; setListingPrice: (value: string) => void; listingDays: number; setListingDays: (value: number) => void; busy: string | null; onList: (price: number) => void; onUnlist: () => void }) {
  const parsed = Number(listingPrice);
  return <>
    <div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium">Ваш лот</p>{gift.listingPrice != null ? <span className="flex items-center gap-1 text-xs"><Gem size={12} fill="currentColor" />{money(gift.listingPrice)}</span> : <span className="text-[11px] text-[var(--muted)]">Не выставлен</span>}</div>
    <div className="grid grid-cols-[minmax(0,1fr)_84px] gap-2">
      <input value={listingPrice} onChange={(event) => setListingPrice(event.target.value)} inputMode="decimal" placeholder={gift.listingPrice == null ? "Цена" : String(gift.listingPrice)} className="min-w-0 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[#555960]" />
      <select value={listingDays} onChange={(event) => setListingDays(Number(event.target.value))} className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-2 text-xs outline-none"><option value={3}>3 дн</option><option value={7}>7 дн</option><option value={14}>14 дн</option><option value={30}>30 дн</option></select>
    </div>
    <PrimaryButton className="mt-2 w-full" disabled={busy !== null || !Number.isFinite(parsed) || parsed <= 0} onClick={() => onList(parsed)}><Tag size={14} className="mr-1 inline" />{busy === "list" ? "…" : gift.status === "listed" ? "Обновить листинг" : "Выставить"}</PrimaryButton>
    {gift.status === "listed" ? <SecondaryButton className="mt-2 w-full" disabled={busy !== null} onClick={onUnlist}>Снять с продажи</SecondaryButton> : null}
  </>;
}

function BuyerTradePanel({ gift, inCart, availableBalance, reservedBalance, offerAmount, setOfferAmount, offerHours, setOfferHours, myOffer, busy, onBuy, onCart, onOffer, onCancelOffer }: { gift: GiftAsset; inCart: boolean; availableBalance: number; reservedBalance: number; offerAmount: string; setOfferAmount: (value: string) => void; offerHours: number; setOfferHours: (value: number) => void; myOffer?: DetailOffer; busy: string | null; onBuy: () => void; onCart: () => void; onOffer: (amount: number) => void; onCancelOffer?: () => void }) {
  const parsed = Number(offerAmount);
  return <>
    <div className="mb-2 flex items-center justify-between text-[10px] text-[var(--muted)]"><span>Доступно {money(availableBalance)}</span>{reservedBalance > 0 ? <span>{money(reservedBalance)} в резерве</span> : null}</div>
    {gift.status === "listed" && gift.listingPrice != null ? <>
      <PrimaryButton className="flex w-full items-center justify-center gap-2 py-3" disabled={busy !== null || availableBalance + (myOffer?.amount || 0) < gift.listingPrice} onClick={onBuy}><ShoppingCart size={16} />{busy === "buy" ? "Покупка…" : <span className="flex items-center gap-1">Купить <Gem size={13} fill="currentColor" />{money(gift.listingPrice)}</span>}</PrimaryButton>
      <SecondaryButton className="mt-2 flex w-full items-center justify-center gap-2" disabled={busy !== null} onClick={onCart}><ShoppingCart size={14} />{busy === "cart" ? "…" : inCart ? "Убрать из корзины" : "Добавить в корзину"}</SecondaryButton>
    </> : <div className="rounded-[18px] bg-[var(--panel-2)] px-3 py-2.5 text-center text-xs text-[var(--muted)]">Не выставлен</div>}
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_84px] gap-2">
      <input value={offerAmount} onChange={(event) => setOfferAmount(event.target.value)} inputMode="decimal" placeholder={myOffer ? `Текущий ${myOffer.amount}` : "Сумма оффера"} className="min-w-0 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none" />
      <select value={offerHours} onChange={(event) => setOfferHours(Number(event.target.value))} className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-2 text-xs outline-none"><option value={24}>24 ч</option><option value={72}>72 ч</option><option value={168}>7 дн</option></select>
    </div>
    <SecondaryButton className="mt-2 w-full" disabled={busy !== null || !Number.isFinite(parsed) || parsed <= 0 || parsed > availableBalance + (myOffer?.amount || 0)} onClick={() => onOffer(parsed)}>{busy === "offer" ? "…" : myOffer ? "Обновить оффер" : "Сделать оффер"}</SecondaryButton>
    {myOffer && onCancelOffer ? <button disabled={busy !== null} onClick={onCancelOffer} className="mt-2 w-full rounded-[18px] bg-[var(--panel-2)] py-2 text-[11px] text-[var(--muted)]">Отменить мой оффер · {money(myOffer.amount)}</button> : null}
  </>;
}

function Trait({ label, value, rarity, floor }: { label: string; value: string; rarity: number | null; floor: number | null }) { return <div className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--border-soft)] px-3 py-3 text-xs last:border-b-0"><span className="text-[var(--muted)]">{label}</span><div className="min-w-0"><p className="truncate text-white">{value}</p>{floor != null ? <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--muted)]">floor <Gem size={9} fill="currentColor" />{money(floor)}</p> : null}</div>{rarity == null ? <span /> : <span className="rounded bg-[rgba(198,170,88,.10)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">{(rarity / 10).toFixed(rarity % 10 ? 1 : 0)}%</span>}</div>; }
function Metric({ label, value, tone }: { label: string; value: string; tone?: number }) { return <div className="rounded-[18px] bg-[var(--panel-2)] p-2.5"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className={`mt-1 truncate text-xs font-semibold ${tone == null ? "" : tone >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{value}</p></div>; }
function SmallMetric({ label, value }: { label: string; value: string }) { return <div><p className="text-[9px] text-[var(--muted)]">{label}</p><p className="mt-0.5 truncate text-xs">{value}</p></div>; }
function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) { return <button onClick={onClick} className={`flex shrink-0 items-center justify-center gap-1.5 rounded-[18px] px-4 py-2 text-[11px] whitespace-nowrap ${active ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}>{icon}{label}</button>; }

function Offers({ offers, isOwner, busy, onAction }: { offers: DetailOffer[]; isOwner: boolean; busy: string | null; onAction: (id: string, action: "accept" | "reject" | "cancel") => void }) {
  if (!offers.length) return <Empty text="Открытых офферов нет" />;
  return <div className="divide-y divide-[var(--border-soft)]">{offers.map((offer) => <div key={offer.id} className="p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-medium">{offer.buyerName}{offer.isMine ? <span className="ml-1.5 text-[9px] text-[var(--accent)]">ВЫ</span> : null}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{ago(offer.createdAt)}{offer.expiresAt ? ` · ещё ${timeUntil(offer.expiresAt)}` : ""}</p></div><p className="flex items-center gap-1 text-sm font-semibold"><Gem size={12} fill="currentColor" />{money(offer.amount)}</p></div>{isOwner ? <div className="mt-2 grid grid-cols-2 gap-2"><button disabled={busy !== null} onClick={() => onAction(offer.id, "reject")} className="flex items-center justify-center gap-1 rounded-[18px] bg-[var(--panel-2)] py-2 text-xs"><X size={13} />Отклонить</button><button disabled={busy !== null} onClick={() => onAction(offer.id, "accept")} className="flex items-center justify-center gap-1 rounded-[18px] bg-[var(--accent)] py-2 text-xs font-semibold text-black"><Check size={13} />Принять</button></div> : offer.isMine ? <button disabled={busy !== null} onClick={() => onAction(offer.id, "cancel")} className="mt-2 w-full rounded-[18px] bg-[var(--panel-2)] py-2 text-xs text-[var(--muted)]">Отменить</button> : null}</div>)}</div>;
}

const activityLabels: Record<GiftActivity["kind"], string> = {
  listed: "Выставлен на продажу",
  repriced: "Цена изменена",
  unlisted: "Снят с продажи",
  expired: "Листинг истёк",
  sold: "Продан",
  offer_accepted: "Оффер принят",
  sale: "Продажа",
  offer: "Оффер",
};

function Activity({ activity }: { activity: GiftActivity[] }) {
  if (!activity.length) return <Empty text="История этого NFT пока пуста" />;
  return <div className="divide-y divide-[var(--border-soft)]">{activity.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-3"><div className="min-w-0"><p className="truncate text-xs font-medium">{activityLabels[item.kind]}</p><p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{item.actorName || "Система"} · {ago(item.createdAt)}{item.previousPrice != null && item.price != null ? ` · ${money(item.previousPrice)} → ${money(item.price)}` : ""}</p></div>{item.price != null ? <p className="flex shrink-0 items-center gap-1 text-xs font-medium"><Gem size={11} fill="currentColor" />{money(item.price)}</p> : null}</div>)}</div>;
}

function Empty({ text }: { text: string }) { return <div className="grid min-h-28 place-items-center px-4 text-center text-xs text-[var(--muted)]">{text}</div>; }
