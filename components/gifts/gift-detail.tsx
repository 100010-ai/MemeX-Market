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
  Star,
  BellRing,
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
type AdvancedOffer = { id: string; buyerId: string; buyerName: string; scopeType: "collection" | "model" | "backdrop" | "symbol"; traitValue: string | null; amount: number; maxFills: number; filledCount: number; expiresAt: string; createdAt: string };
type Payload = {
  gift: GiftAsset;
  resolvedVirtualGiftId?: string;
  isOwner: boolean;
  inCart: boolean;
  watched: boolean;
  itemStats: { tradeCount: number; volume: number; highSale: number | null; lowSale: number | null };
  balance: number;
  availableBalance: number;
  reservedBalance: number;
  candles: Candle[];
  collection: GiftCollection;
  traitStats: GiftTraitStats;
  offers: DetailOffer[];
  advancedOffers: AdvancedOffer[];
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
    case "mxm_listing": return "Лот MXM";
    case "tonapi_listing": return "Лот TON";
    case "item_last_sale": return "Последняя продажа";
    case "collection_last_sale": return "Продажа коллекции";
    default: return "Нет цены";
  }
}

function giftRarity(gift: GiftAsset) {
  const frequencies = [gift.modelRarityPerMille, gift.backdropRarityPerMille, gift.symbolRarityPerMille]
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.min(1, Math.max(0.0001, value / 1000)));
  if (!frequencies.length) return { score: null as number | null, percentile: null as number | null };
  const geometricMean = Math.pow(frequencies.reduce((product, value) => product * value, 1), 1 / frequencies.length);
  return {
    score: Math.round((100 - geometricMean * 100) * 10) / 10,
    percentile: Math.max(0.01, Math.round(geometricMean * 10000) / 100),
  };
}

function premiumNumberLabel(number: number) {
  const digits = String(Math.max(0, Math.trunc(number)));
  if (number >= 1 && number <= 100) return "#1–100";
  if (/^(\d)\1{2,}$/.test(digits)) return "Одинаковые цифры";
  if (/^\d0{2,}$/.test(digits)) return "Круглый номер";
  if (digits.length >= 3 && digits === [...digits].reverse().join("")) return "Зеркальный номер";
  const ascending = "01234567890123456789".includes(digits);
  const descending = "98765432109876543210".includes(digits);
  if (digits.length >= 3 && (ascending || descending)) return "Последовательность";
  return null;
}

export function GiftDetail({ id, onClose }: { id: string; onClose?: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<DetailTab>("activity");
  const [listingPrice, setListingPrice] = useState("");
  const [listingDays, setListingDays] = useState(7);
  const [offerAmount, setOfferAmount] = useState("");
  const [offerHours, setOfferHours] = useState(72);
  const [alertPrice, setAlertPrice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
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
    buyRequestKey.current = null;
    const timer = window.setTimeout(() => {
      setData(null);
      setError(null);
      setChartLoading(false);
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      loadSequence.current += 1;
    };
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

  async function run(key: string, task: () => Promise<unknown>, successMessage?: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    setActionNotice(null);
    haptic("medium");
    try {
      await task();
      await Promise.allSettled([load(), refreshProfile()]);
      if (successMessage) setActionNotice(successMessage);
      haptic("heavy");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие");
      // If another player bought/changed the lot first, immediately replace stale
      // listing data instead of leaving a dead CTA on screen.
      if (key === "buy" || key.startsWith("accept-")) await load().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }


  async function toggleWatch() {
    if (!data || busy) return;
    const enabled = !data.watched;
    await run("watch", async () => {
      await apiFetch("/api/watchlist", { method: "POST", body: JSON.stringify({ kind: "gift", giftId: data.resolvedVirtualGiftId || data.gift.virtualGiftId, enabled }) });
      setData((current) => current ? { ...current, watched: enabled } : current);
    }, enabled ? "Подарок добавлен в избранное" : "Подарок убран из избранного");
  }

  async function createAlert() {
    if (!data || busy) return;
    const targetPrice = Number(alertPrice);
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) { setError("Укажите корректную цену уведомления"); return; }
    await run("alert", async () => {
      await apiFetch("/api/alerts", { method: "POST", body: JSON.stringify({ kind: "gift", giftId: data.resolvedVirtualGiftId || data.gift.virtualGiftId, direction: "below", targetPrice }) });
      setAlertPrice("");
    }, `Уведомление создано для цены ${money(targetPrice)}`);
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
        <p className="text-sm font-medium text-white">Не удалось открыть подарок</p>
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
  const rarity = giftRarity(gift);
  const premiumNumber = premiumNumberLabel(gift.number);

  return (
    <div>
      <RealtimeRefresh
        channelName={`mxm-gift-${canonicalGiftId}`}
        tables={realtimeTables}
        filters={{
          virtual_gifts: `id=eq.${canonicalGiftId}`,
          gift_trades: `virtual_gift_id=eq.${canonicalGiftId}`,
          gift_offers: `virtual_gift_id=eq.${canonicalGiftId}`,
          gift_listing_events: `virtual_gift_id=eq.${canonicalGiftId}`,
          market_events: `virtual_gift_id=eq.${canonicalGiftId}`,
        }}
        onChange={realtimeReload}
        debounceMs={900}
      />

      <div className="mb-3 flex items-center justify-between gap-3">
        {onClose ? (
          <button onClick={onClose} aria-label="Закрыть" className="grid h-9 w-9 place-items-center rounded-[18px] border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"><X size={17} /></button>
        ) : (
          <Link href="/market" className="grid h-9 w-9 place-items-center rounded-[18px] border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"><ArrowLeft size={17} /></Link>
        )}
        <div className="flex items-center gap-1.5"><button onClick={() => void toggleWatch()} disabled={busy !== null} aria-label={data.watched ? "Убрать из избранного" : "В избранное"} className={`grid h-9 w-9 place-items-center rounded-[18px] border border-[var(--border)] bg-[var(--panel-2)] ${data.watched ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}><Star size={14} fill={data.watched ? "currentColor" : "none"} /></button><a href={gift.telegramName.startsWith("ton:") ? `https://tonviewer.com/${encodeURIComponent(gift.telegramName.slice(4))}` : `https://t.me/nft/${encodeURIComponent(gift.telegramName)}`} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-1.5 rounded-[18px] border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[11px] text-[var(--muted)]">{gift.telegramName.startsWith("ton:") ? "TON" : "Telegram"} <ExternalLink size={12} /></a></div>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="min-w-0">
          <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)]"><GiftMedia gift={gift} className="aspect-square w-full" /></div>
          <div className="mt-3 rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold">{gift.baseName}</h1>
                <p className="mt-0.5 truncate text-xs text-[var(--muted)]">#{gift.number} · {gift.modelName}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {rarity.score != null ? <span className="rounded-[12px] bg-[rgba(198,170,88,.10)] px-2 py-1 text-[9px] text-[var(--accent)]">Редкость {rarity.score.toFixed(1)} / 100</span> : null}
                  {premiumNumber ? <span className="rounded-[12px] bg-[var(--panel-2)] px-2 py-1 text-[9px] text-white">Особый номер · {premiumNumber}</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {gift.chainVerified ? <span title="Подарок подтверждён в TON" className="grid h-6 w-6 place-items-center rounded-full bg-[rgba(76,189,126,.12)] text-[var(--positive)]"><ShieldCheck size={13} /></span> : null}
                {gift.isFromBlockchain ? <span className="rounded-[18px] bg-[var(--panel-2)] px-2 py-1 text-[9px] text-[var(--muted)]">TON</span> : null}
              </div>
            </div>
            <Link href={`/u/${gift.ownerId}`} className="mt-3 flex items-center gap-2 rounded-[18px] bg-[var(--panel-2)] px-3 py-2.5"><UserRound size={14} className="text-[var(--muted)]" /><div className="min-w-0 flex-1"><p className="text-[10px] text-[var(--muted)]">Владелец</p><p className="truncate text-xs font-medium">{gift.ownerName}</p></div></Link>
          </div>
        </section>

        <section className="min-w-0 space-y-3">
          <div className="mxm-surface p-3">
            <div className="mxm-gift-metrics grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <Metric label="Цена" value={gift.listingPrice == null ? "—" : money(gift.listingPrice)} />
              <Metric label="Floor" value={data.traitStats.collectionFloor == null ? "—" : money(data.traitStats.collectionFloor)} />
              <Metric label="Оффер" value={gift.bestOffer == null ? "—" : money(gift.bestOffer)} />
              <Metric label="24h" value={percent(data.collection.change24h)} tone={data.collection.change24h} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <SmallMetric label="Сделки" value={String(data.itemStats.tradeCount)} />
              <SmallMetric label="Объём" value={money(data.itemStats.volume)} />
              <SmallMetric label="В продаже" value={`${data.collection.listedPct.toFixed(1)}%`} />
            </div>
            <details className="mxm-gift-market-details mt-2">
              <summary>Детали рынка</summary>
              <div className="grid grid-cols-2 gap-2 border-t border-[var(--border-soft)] pt-2 sm:grid-cols-4">
                <SmallMetric label="Макс. продажа" value={data.itemStats.highSale == null ? "—" : money(data.itemStats.highSale)} />
                <SmallMetric label="Продажи 7д" value={String(data.collection.tradeCount7d)} />
                <SmallMetric label="Ориентир" value={gift.referencePrice == null ? "—" : money(gift.referencePrice)} />
                <SmallMetric label="Источник" value={priceBasisLabel(gift)} />
                {rarity.percentile != null ? <SmallMetric label="Редкость" value={`топ ${rarity.percentile.toFixed(rarity.percentile < 1 ? 2 : 1)}%`} /> : <SmallMetric label="Редкость" value="—" />}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-[var(--muted-2)]">
                {gift.externalPriceSource ? <span>{gift.externalPriceSource}</span> : null}
                {gift.externalPriceSeenAt ? <span>{ago(gift.externalPriceSeenAt)}</span> : null}
                {premiumToFloor != null ? <span className={premiumToFloor <= 0 ? "text-[var(--positive)]" : ""}>{premiumToFloor >= 0 ? "+" : ""}{premiumToFloor.toFixed(1)}% к floor</span> : null}
                {gift.status === "listed" && expiry ? <span className="inline-flex items-center gap-1"><Clock3 size={9} />{expiry}</span> : null}
              </div>
            </details>
          </div>

          {error ? <div className="rounded-[18px] border border-[#5a3035] bg-[#25191b] px-3 py-2.5 text-xs text-[#ff9aa4]">{error}</div> : null}
          {actionNotice ? <div aria-live="polite" className="mxm-gift-action-notice flex items-center gap-2 rounded-[18px] border border-[rgba(76,189,126,.18)] bg-[rgba(76,189,126,.07)] px-3 py-2.5 text-[11px] text-[var(--positive)]"><Check size={14} />{actionNotice}</div> : null}

          <div className="mxm-gift-trade-panel mxm-surface p-3">
            {gift.isBurned ? (
              <div className="rounded-[18px] border border-[#5a3035] bg-[#25191b] px-3 py-3 text-xs text-[#ff9aa4]">Telegram пометил этот подарок как сожжённый. В MXM для него отключены продажа, предложения и покупки.</div>
            ) : data.isOwner ? (
              <OwnerTradePanel
                gift={gift}
                listingPrice={listingPrice}
                setListingPrice={setListingPrice}
                listingDays={listingDays}
                setListingDays={setListingDays}
                busy={busy}
                onList={(price) => run(
                  "list",
                  () => apiFetch(`/api/gifts/${encodeURIComponent(canonicalGiftId)}/list`, { method: "POST", body: JSON.stringify({ price, durationDays: listingDays }) }),
                  gift.status === "listed" ? `Цена лота обновлена: ${money(price)}` : `Лот выставлен за ${money(price)}`,
                )}
                onUnlist={() => run(
                  "unlist",
                  () => apiFetch(`/api/gifts/${encodeURIComponent(canonicalGiftId)}/list`, { method: "POST", body: JSON.stringify({ price: null }) }),
                  "Лот снят с продажи",
                )}
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
                  }, `Подарок куплен за ${money(gift.listingPrice || 0)} и добавлен в портфель`);
                }}
                onCart={() => run(
                  "cart",
                  () => apiFetch("/api/cart", { method: "POST", body: JSON.stringify({ action: data.inCart ? "remove" : "add", virtualGiftId: canonicalGiftId }) }),
                  data.inCart ? "Подарок убран из корзины" : "Подарок добавлен в корзину",
                )}
                onOffer={(amount) => run(
                  "offer",
                  () => apiFetch(`/api/gifts/${encodeURIComponent(canonicalGiftId)}/offer`, { method: "POST", body: JSON.stringify({ amount, durationHours: offerHours }) }),
                  `Предложение ${money(amount)} создано, сумма зарезервирована`,
                )}
                onCancelOffer={myOffer ? () => run(
                  "cancel-offer",
                  () => apiFetch(`/api/gifts/offers/${myOffer.id}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) }),
                  "Предложение отменено, резерв освобождён",
                ) : undefined}
              />
            )}
            
          </div>

          <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)]">
            <Link href={`/collections/${encodeURIComponent(gift.baseName)}`} className="block"><Trait label="Коллекция" value={gift.baseName} rarity={null} floor={data.traitStats.collectionFloor} /></Link>
            <Trait label="Модель" value={gift.modelName} rarity={gift.modelRarityPerMille} floor={data.traitStats.modelFloor} />
            <Trait label="Фон" value={gift.backdropName} rarity={gift.backdropRarityPerMille} floor={data.traitStats.backdropFloor} />
            <Trait label="Символ" value={gift.symbolName} rarity={gift.symbolRarityPerMille} floor={data.traitStats.symbolFloor} />
          </div>
          <div className="flex items-center justify-between gap-2 px-1 text-[9px] text-[var(--muted)]"><span>Сравнить с рынком</span><Link href={`/market?tab=gifts&collection=${encodeURIComponent(gift.baseName)}`} className="text-[var(--accent)]">Похожие лоты</Link></div>

          {data.isOwner && data.advancedOffers.length ? <div className="overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)]"><div className="border-b border-[var(--border-soft)] px-3 py-2.5"><p className="text-xs font-medium">Подходящие предложения</p></div><div className="divide-y divide-[var(--border-soft)]">{data.advancedOffers.slice(0, 8).map((offer) => <div key={offer.id} className="flex items-center gap-3 px-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{offer.buyerName}</p><p className="mt-0.5 truncate text-[9px] text-[var(--muted)]">{advancedScopeLabel(offer)} · ещё {timeUntil(offer.expiresAt)}</p></div><span className="flex shrink-0 items-center gap-1 text-xs font-semibold"><Gem size={10} fill="currentColor" />{money(offer.amount)}</span><button type="button" disabled={busy !== null} onClick={() => void run(`accept-advanced-${offer.id}`, () => apiFetch(`/api/market/offers/${offer.id}`, { method: "POST", body: JSON.stringify({ action: "accept", virtualGiftId: canonicalGiftId }) }))} className="rounded-[14px] bg-[var(--accent)] px-2.5 py-2 text-[10px] font-semibold text-black disabled:opacity-50">Принять</button></div>)}</div></div> : null}

          <details className="mxm-gift-market-details mxm-surface px-3">
            <summary><span className="inline-flex items-center gap-1.5"><BellRing size={12} className="text-[var(--accent)]" />Уведомить о цене</span></summary>
            <div className="flex gap-2 border-t border-[var(--border-soft)] py-3"><input value={alertPrice} onChange={(event) => setAlertPrice(event.target.value.replace(",", "."))} inputMode="decimal" placeholder={String(gift.listingPrice || gift.referencePrice || gift.collectionFloor || "Цена TON")} className="mxm-input min-w-0 flex-1 !py-2 !text-[10px]" /><button onClick={() => void createAlert()} disabled={busy !== null} className="mxm-secondary-action mxm-pressable shrink-0">Создать</button></div>
          </details>

          <div className="mxm-hscroll gap-1 rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-1">
            <TabButton active={tab === "activity"} onClick={() => void openTab("activity")} icon={<History size={12} />} label="История" />
            <TabButton active={tab === "offers"} onClick={() => void openTab("offers")} icon={<MessageSquareMore size={12} />} label={`Предложения · ${data.offers.length}`} />
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
  const marketPrice = gift.modelFloor ?? gift.referencePrice ?? gift.collectionFloor ?? gift.lastSalePrice;
  const quickPrice = gift.collectionFloor != null ? gift.collectionFloor * 0.97 : marketPrice != null ? marketPrice * 0.95 : null;
  const premiumPrice = marketPrice != null ? marketPrice * 1.1 : null;
  const enteredDelta = Number.isFinite(parsed) && parsed > 0 && marketPrice != null && marketPrice > 0 ? ((parsed / marketPrice) - 1) * 100 : null;
  const setSuggested = (value: number | null) => { if (value != null && Number.isFinite(value) && value > 0) setListingPrice(value.toFixed(2)); };
  return <>
    <div className="mxm-trade-panel-head mb-3 flex items-start justify-between gap-3"><div><p className="text-[9px] uppercase tracking-[.12em] text-[var(--muted-2)]">Управление продажей</p><p className="mt-1 text-sm font-semibold">{gift.status === "listed" ? "Активный лот" : "Выставить подарок"}</p><p className="mt-1 text-[9px] text-[var(--muted)]">Цена и доступность подтверждаются сервером.</p></div>{gift.listingPrice != null ? <div className="text-right"><p className="text-[9px] text-[var(--muted)]">Текущая цена</p><span className="mt-1 flex items-center justify-end gap-1 text-sm font-semibold"><Gem size={12} className="text-[var(--accent)]" fill="currentColor" />{money(gift.listingPrice)}</span></div> : <span className="rounded-full bg-[var(--panel-2)] px-2.5 py-1.5 text-[9px] text-[var(--muted)]">Не выставлен</span>}</div>
    {marketPrice != null ? <div className="mb-3 grid grid-cols-3 gap-1.5" aria-label="Рыночные ориентиры">
      <button type="button" onClick={() => setSuggested(quickPrice)} className="mxm-price-preset rounded-[14px] bg-[var(--panel-2)] px-2 py-2.5 text-left"><span className="block text-[8px] text-[var(--muted)]">Быстрый выход</span><span className="mt-1 block text-[10px] font-semibold">{quickPrice == null ? "—" : money(quickPrice)}</span></button>
      <button type="button" onClick={() => setSuggested(marketPrice)} className="mxm-price-preset rounded-[14px] bg-[var(--panel-2)] px-2 py-2.5 text-left"><span className="block text-[8px] text-[var(--muted)]">Ориентир</span><span className="mt-1 block text-[10px] font-semibold">{money(marketPrice)}</span></button>
      <button type="button" onClick={() => setSuggested(premiumPrice)} className="mxm-price-preset rounded-[14px] bg-[var(--panel-2)] px-2 py-2.5 text-left"><span className="block text-[8px] text-[var(--muted)]">Премия +10%</span><span className="mt-1 block text-[10px] font-semibold">{premiumPrice == null ? "—" : money(premiumPrice)}</span></button>
    </div> : null}
    <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
      <label className="min-w-0"><span className="mb-1.5 block text-[9px] text-[var(--muted)]">Цена за подарок</span><input aria-label="Цена лота в TON" value={listingPrice} onChange={(event) => setListingPrice(event.target.value.replace(",", "."))} inputMode="decimal" placeholder={gift.listingPrice == null ? "0.00 TON" : String(gift.listingPrice)} className="mxm-input min-w-0 !py-3 !text-sm" /></label>
      <label><span className="mb-1.5 block text-[9px] text-[var(--muted)]">Срок</span><select aria-label="Срок размещения" value={listingDays} onChange={(event) => setListingDays(Number(event.target.value))} className="mxm-input h-[46px] px-2 text-xs"><option value={3}>3 дня</option><option value={7}>7 дней</option><option value={14}>14 дней</option><option value={30}>30 дней</option></select></label>
    </div>
    <div className="mt-2 flex min-h-4 items-center justify-between gap-2 text-[8px] text-[var(--muted-2)]"><span>{enteredDelta == null ? "Укажите цену, чтобы сравнить с рынком" : `${enteredDelta >= 0 ? "+" : ""}${enteredDelta.toFixed(1)}% к рыночному ориентиру`}</span><span>{listingDays} дн.</span></div>
    <PrimaryButton className="mt-3 w-full !py-3" disabled={busy !== null || !Number.isFinite(parsed) || parsed <= 0} onClick={() => onList(parsed)}><Tag size={14} className="mr-1 inline" />{busy === "list" ? "Сохраняем…" : gift.status === "listed" ? "Обновить активный лот" : "Выставить на рынок"}</PrimaryButton>
    {gift.status === "listed" ? <SecondaryButton className="mt-2 w-full" disabled={busy !== null} onClick={onUnlist}>Снять лот с продажи</SecondaryButton> : null}
  </>;
}


function advancedScopeLabel(offer: AdvancedOffer) {
  if (offer.scopeType === "collection") return "Любой подарок коллекции";
  if (offer.scopeType === "model") return `Модель · ${offer.traitValue || "—"}`;
  if (offer.scopeType === "backdrop") return `Фон · ${offer.traitValue || "—"}`;
  return `Символ · ${offer.traitValue || "—"}`;
}

function BuyerTradePanel({ gift, inCart, availableBalance, reservedBalance, offerAmount, setOfferAmount, offerHours, setOfferHours, myOffer, busy, onBuy, onCart, onOffer, onCancelOffer }: { gift: GiftAsset; inCart: boolean; availableBalance: number; reservedBalance: number; offerAmount: string; setOfferAmount: (value: string) => void; offerHours: number; setOfferHours: (value: number) => void; myOffer?: DetailOffer; busy: string | null; onBuy: () => void; onCart: () => void; onOffer: (amount: number) => void; onCancelOffer?: () => void }) {
  const parsed = Number(offerAmount);
  const spendableBalance = availableBalance + (myOffer?.amount || 0);
  const listingPrice = gift.listingPrice;
  const canBuy = gift.status === "listed" && listingPrice != null && spendableBalance >= listingPrice;
  const balanceAfter = listingPrice == null ? null : spendableBalance - listingPrice;
  const [buyArmed, setBuyArmed] = useState(false);
  useEffect(() => {
    if (!buyArmed) return;
    const timer = window.setTimeout(() => setBuyArmed(false), 3_500);
    return () => window.clearTimeout(timer);
  }, [buyArmed]);
  useEffect(() => { if (busy === "buy") setBuyArmed(false); }, [busy]);
  useEffect(() => { setBuyArmed(false); }, [gift.listingPrice]);
  return <>
    <div className="mxm-trade-panel-head mb-3 flex items-start justify-between gap-3">
      <div><p className="text-[9px] uppercase tracking-[.12em] text-[var(--muted-2)]">Покупка подарка</p><p className="mt-1 text-sm font-semibold">{gift.status === "listed" && listingPrice != null ? "Активный лот" : "Лот не выставлен"}</p><p className="mt-1 inline-flex items-center gap-1 text-[9px] text-[var(--muted)]"><ShieldCheck size={11} className="text-[var(--positive)]" />Сервер проверит цену и владельца</p></div>
      <div className="text-right"><p className="text-[9px] text-[var(--muted)]">Цена сейчас</p><p className="mt-1 flex items-center justify-end gap-1 text-base font-semibold"><Gem size={13} className="text-[var(--accent)]" fill="currentColor" />{listingPrice == null ? "—" : money(listingPrice)}</p></div>
    </div>
    <div className="mb-3 grid grid-cols-3 gap-1.5 rounded-[16px] bg-[var(--panel-2)] p-2">
      <SmallMetric label="Доступно" value={money(availableBalance)} />
      <SmallMetric label="В резерве" value={money(reservedBalance)} />
      <SmallMetric label="После покупки" value={balanceAfter == null ? "—" : money(balanceAfter)} />
    </div>
    {gift.status === "listed" && gift.listingPrice != null ? <>
      <PrimaryButton className="flex w-full items-center justify-center gap-2 !py-3" disabled={busy !== null || !canBuy} onClick={() => { if (buyArmed) onBuy(); else setBuyArmed(true); }}><ShoppingCart size={16} />{busy === "buy" ? "Проверяем и покупаем…" : !canBuy ? "Недостаточно TON" : buyArmed ? <span className="flex items-center gap-1">Подтвердить списание <Gem size={13} fill="currentColor" />{money(gift.listingPrice)}</span> : <span className="flex items-center gap-1">Купить сейчас · <Gem size={13} fill="currentColor" />{money(gift.listingPrice)}</span>}</PrimaryButton>
      <SecondaryButton className="mt-2 flex w-full items-center justify-center gap-2 !py-2.5" disabled={busy !== null} onClick={onCart}><ShoppingCart size={14} fill={inCart ? "currentColor" : "none"} />{busy === "cart" ? "Обновляем…" : inCart ? "Убрать из корзины" : "Добавить в корзину"}</SecondaryButton>
      {buyArmed ? <p aria-live="polite" className="mt-2 text-center text-[9px] text-[var(--accent)]">Повторное нажатие подтвердит покупку. Цена ещё раз проверится сервером.</p> : null}
    </> : <div className="rounded-[18px] bg-[var(--panel-2)] px-3 py-2.5 text-center text-xs text-[var(--muted)]">Не выставлен</div>}
    <details className="mxm-gift-market-details mxm-offer-composer mt-3" defaultOpen={Boolean(myOffer)}>
      <summary><span>Предложить свою цену</span>{myOffer ? <span className="text-[var(--accent)]">Активно · {money(myOffer.amount)}</span> : <span>Необязательно</span>}</summary>
      <div className="border-t border-[var(--border-soft)] pt-3">
        <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
          <label className="min-w-0"><span className="mb-1.5 block text-[9px] text-[var(--muted)]">Цена предложения</span><input aria-label="Цена предложения в TON" value={offerAmount} onChange={(event) => setOfferAmount(event.target.value.replace(",", "."))} inputMode="decimal" placeholder={myOffer ? `Текущее: ${money(myOffer.amount)}` : "0.00 TON"} className="mxm-input min-w-0 !py-3 !text-sm" /></label>
          <label><span className="mb-1.5 block text-[9px] text-[var(--muted)]">Срок</span><select aria-label="Срок предложения" value={offerHours} onChange={(event) => setOfferHours(Number(event.target.value))} className="mxm-input h-[46px] px-2 text-xs"><option value={24}>24 часа</option><option value={72}>3 дня</option><option value={168}>7 дней</option></select></label>
        </div>
        <p className="mt-2 text-[8px] leading-4 text-[var(--muted-2)]">Сумма резервируется до исполнения, отмены или окончания срока и не может быть потрачена дважды.</p>
        <SecondaryButton className="mt-2 w-full !py-2.5" disabled={busy !== null || !Number.isFinite(parsed) || parsed <= 0 || parsed > spendableBalance} onClick={() => onOffer(parsed)}>{busy === "offer" ? "Сохраняем…" : myOffer ? "Обновить предложение" : "Создать предложение"}</SecondaryButton>
        {myOffer && onCancelOffer ? <button disabled={busy !== null} onClick={onCancelOffer} className="mt-2 min-h-10 w-full rounded-[18px] bg-[var(--panel-2)] py-2 text-[10px] text-[var(--muted)]">Отменить и освободить {money(myOffer.amount)}</button> : null}
      </div>
    </details>
  </>;
}

function Trait({ label, value, rarity, floor }: { label: string; value: string; rarity: number | null; floor: number | null }) { return <div className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--border-soft)] px-3 py-3 text-xs last:border-b-0"><span className="text-[var(--muted)]">{label}</span><div className="min-w-0"><p className="truncate text-white">{value}</p>{floor != null ? <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--muted)]">мин. цена <Gem size={9} fill="currentColor" />{money(floor)}</p> : null}</div>{rarity == null ? <span /> : <span className="rounded bg-[rgba(198,170,88,.10)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">{(rarity / 10).toFixed(rarity % 10 ? 1 : 0)}%</span>}</div>; }
function Metric({ label, value, tone }: { label: string; value: string; tone?: number }) { return <div className="mxm-gift-metric"><p className="text-[10px] text-[var(--muted)]">{label}</p><p className={`mt-1 truncate text-xs font-semibold ${tone == null ? "" : tone >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{value}</p></div>; }
function SmallMetric({ label, value }: { label: string; value: string }) { return <div><p className="text-[9px] text-[var(--muted)]">{label}</p><p className="mt-0.5 truncate text-xs">{value}</p></div>; }
function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) { return <button onClick={onClick} className={`flex shrink-0 items-center justify-center gap-1.5 rounded-[18px] px-4 py-2 text-[11px] whitespace-nowrap ${active ? "bg-[var(--panel-3)] text-white" : "text-[var(--muted)]"}`}>{icon}{label}</button>; }

function Offers({ offers, isOwner, busy, onAction }: { offers: DetailOffer[]; isOwner: boolean; busy: string | null; onAction: (id: string, action: "accept" | "reject" | "cancel") => void }) {
  if (!offers.length) return <Empty text="Открытых предложений нет" />;
  return <div className="divide-y divide-[var(--border-soft)]">{offers.map((offer) => <div key={offer.id} className="p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-medium">{offer.buyerName}{offer.isMine ? <span className="ml-1.5 text-[9px] text-[var(--accent)]">ВЫ</span> : null}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{ago(offer.createdAt)}{offer.expiresAt ? ` · ещё ${timeUntil(offer.expiresAt)}` : ""}</p></div><p className="flex items-center gap-1 text-sm font-semibold"><Gem size={12} fill="currentColor" />{money(offer.amount)}</p></div>{isOwner ? <div className="mt-2 grid grid-cols-2 gap-2"><button disabled={busy !== null} onClick={() => onAction(offer.id, "reject")} className="flex items-center justify-center gap-1 rounded-[18px] bg-[var(--panel-2)] py-2 text-xs"><X size={13} />Отклонить</button><button disabled={busy !== null} onClick={() => onAction(offer.id, "accept")} className="flex items-center justify-center gap-1 rounded-[18px] bg-[var(--accent)] py-2 text-xs font-semibold text-black"><Check size={13} />Принять</button></div> : offer.isMine ? <button disabled={busy !== null} onClick={() => onAction(offer.id, "cancel")} className="mt-2 w-full rounded-[18px] bg-[var(--panel-2)] py-2 text-xs text-[var(--muted)]">Отменить</button> : null}</div>)}</div>;
}

const activityLabels: Record<GiftActivity["kind"], string> = {
  listed: "Выставлен на продажу",
  repriced: "Цена изменена",
  unlisted: "Снят с продажи",
  expired: "Срок продажи истёк",
  sold: "Продан",
  offer_accepted: "Предложение принято",
  sale: "Продажа",
  offer: "Предложение",
};

function Activity({ activity }: { activity: GiftActivity[] }) {
  if (!activity.length) return <Empty text="История этого подарка пока пуста" />;
  return <div className="divide-y divide-[var(--border-soft)]">{activity.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-3"><div className="min-w-0"><p className="truncate text-xs font-medium">{activityLabels[item.kind]}</p><p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{item.actorName || "Система"} · {ago(item.createdAt)}{item.previousPrice != null && item.price != null ? ` · ${money(item.previousPrice)} → ${money(item.price)}` : ""}</p></div>{item.price != null ? <p className="flex shrink-0 items-center gap-1 text-xs font-medium"><Gem size={11} fill="currentColor" />{money(item.price)}</p> : null}</div>)}</div>;
}

function Empty({ text }: { text: string }) { return <div className="grid min-h-28 place-items-center px-4 text-center text-xs text-[var(--muted)]">{text}</div>; }
