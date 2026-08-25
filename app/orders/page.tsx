"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Clock3, Gem, Inbox, Send, Store, Tag } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { GiftAsset, GiftOffer } from "@/lib/types";
import { ago, money } from "@/lib/format";
import { useTelegramProfile } from "@/components/telegram-provider";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { GiftMedia } from "@/components/gifts/gift-media";

const realtimeGiftTables = ["virtual_gifts"];
const realtimeOfferTables = ["gift_offers"];
type Payload = {
  outgoing: GiftOffer[];
  incoming: GiftOffer[];
  listings: GiftAsset[];
  counts?: { outgoing: number; incoming: number; listings: number };
  truncated?: { outgoing: boolean; incoming: boolean; listings: boolean };
  capabilities?: { sellerScopedOffers?: boolean };
};

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
  useEffect(() => {
    if (data.capabilities?.sellerScopedOffers !== false) return;
    // Compatibility mode for databases that have not applied the optimized
    // seller_profile_id migration yet. Keep incoming offers fresh without a
    // Realtime filter that references a column missing from that schema.
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load().catch(() => undefined);
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [data.capabilities?.sellerScopedOffers, load]);
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
  const incomingValue = data.incoming.reduce((total, offer) => total + Math.max(0, offer.amount), 0);
  const outgoingValue = data.outgoing.reduce((total, offer) => total + Math.max(0, offer.amount), 0);
  const listingValue = data.listings.reduce((total, gift) => total + Math.max(0, gift.listingPrice || 0), 0);
  return (
    <div className="mx-auto max-w-5xl mxm-page-enter">
      <RealtimeRefresh
        channelName="mxm-orders-gifts"
        tables={realtimeGiftTables}
        filters={profile?.id ? { virtual_gifts: `owner_profile_id=eq.${profile.id}` } : undefined}
        onChange={realtimeReload}
        debounceMs={900}
      />
      {profile?.id ? <RealtimeRefresh channelName="mxm-orders-offers-out" tables={realtimeOfferTables} filters={{ gift_offers: `buyer_profile_id=eq.${profile.id}` }} onChange={realtimeReload} debounceMs={650} /> : null}
      {profile?.id && data.capabilities?.sellerScopedOffers === true ? <RealtimeRefresh channelName="mxm-orders-offers-in" tables={realtimeOfferTables} filters={{ gift_offers: `seller_profile_id=eq.${profile.id}` }} onChange={realtimeReload} debounceMs={650} /> : null}

      <header className="mxm-compact-page-head">
        <div><p className="mxm-eyebrow">Trade operations</p><h1 className="mxm-page-title mt-1">Заявки и лоты</h1><p className="mt-1 text-[9px] text-[var(--muted)]">Единый центр предложений, резервов и активных продаж.</p></div>
        <Link href="/market" className="mxm-compact-link">Открыть рынок<ArrowUpRight size={12} /></Link>
      </header>

      <section className="mxm-orders-summary mb-3" aria-label="Сводка по операциям">
        <OrdersMetric icon={<Inbox size={13} />} label="Ждут решения" value={String(data.counts?.incoming ?? data.incoming.length)} detail={incomingValue > 0 ? money(incomingValue) : "Нет входящего объёма"} tone={data.incoming.length ? "attention" : "neutral"} />
        <OrdersMetric icon={<Send size={13} />} label="Зарезервировано" value={money(outgoingValue)} detail={`${data.counts?.outgoing ?? data.outgoing.length} исходящих`} />
        <OrdersMetric icon={<Store size={13} />} label="На продаже" value={money(listingValue)} detail={`${data.counts?.listings ?? data.listings.length} активных лотов`} />
      </section>

      <div className="mxm-segment mb-3" role="tablist" aria-label="Тип операций">
        <Tab label="Входящие" count={data.counts?.incoming ?? data.incoming.length} active={tab === "incoming"} onClick={() => setTab("incoming")} />
        <Tab label="Исходящие" count={data.counts?.outgoing ?? data.outgoing.length} active={tab === "outgoing"} onClick={() => setTab("outgoing")} />
        <Tab label="Лоты" count={data.counts?.listings ?? data.listings.length} active={tab === "listings"} onClick={() => setTab("listings")} />
      </div>

      {error ? <div className="mb-3 mxm-alert mxm-alert-error flex items-center justify-between gap-3"><span>{error}</span><button type="button" onClick={() => { setLoading(true); setError(null); void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить заявки")).finally(() => setLoading(false)); }} className="shrink-0 underline">Повторить</button></div> : null}
      {!loading && ((tab === "incoming" && data.truncated?.incoming) || (tab === "outgoing" && data.truncated?.outgoing) || (tab === "listings" && data.truncated?.listings)) ? <p className="mb-3 text-[9px] text-[var(--muted-2)]">Показаны самые актуальные записи. Старые данные остаются в истории операций.</p> : null}

      {loading ? <div className="grid gap-2"><div className="mxm-skeleton h-[92px] rounded-[15px]" /><div className="mxm-skeleton h-[92px] rounded-[15px]" /><div className="mxm-skeleton h-[92px] rounded-[15px]" /></div> : tab === "listings" ? (
        data.listings.length ? <div className="grid gap-2">{data.listings.map((gift) => <article key={gift.virtualGiftId} className="mxm-order-card"><Link href={`/gifts/${gift.virtualGiftId}`} className="mxm-order-media"><GiftMedia gift={gift} compact className="h-full w-full rounded-[13px]" /></Link><div className="min-w-0"><div className="flex items-center gap-2"><span className="mxm-order-state is-live"><span />В продаже</span><span className="text-[7px] text-[var(--muted-2)]">Лот #{gift.number}</span></div><Link href={`/gifts/${gift.virtualGiftId}`} className="mt-1.5 block truncate text-[11px] font-semibold">{gift.baseName}</Link><p className="mt-0.5 truncate text-[8px] text-[var(--muted)]">{gift.modelName} · {gift.backdropName}</p></div><div className="mxm-order-value"><small>Цена</small><strong><Gem size={10} fill="currentColor" />{gift.listingPrice == null ? "—" : money(gift.listingPrice)}</strong></div><button disabled={busy !== null} onClick={() => void unlist(gift.virtualGiftId)} className="mxm-secondary-action !min-h-8 !px-2.5" aria-label={`Снять ${gift.baseName} с продажи`}>{busy === `${gift.virtualGiftId}unlist` ? "Снимаем…" : "Снять"}</button></article>)}</div> : <Empty text="Активных лотов нет" detail="Выберите подарок в хранилище и назначьте цену продажи." icon={<Tag />} action={<Link href="/vault" className="mxm-secondary-action">Открыть хранилище</Link>} />
      ) : current.length ? (
        <div className="grid gap-2">{current.map((offer) => <article key={offer.id} className="mxm-order-card is-offer"><Link href={`/gifts/${offer.virtualGiftId}`} className="mxm-order-media"><GiftMedia gift={offer.gift} compact className="h-full w-full rounded-[13px]" /></Link><div className="min-w-0"><div className="flex items-center gap-2"><span className={`mxm-order-state ${tab === "incoming" ? "is-attention" : ""}`}><Clock3 size={9} />{tab === "incoming" ? "Нужно решение" : "Ожидает ответа"}</span><span className="text-[7px] text-[var(--muted-2)]">{ago(offer.createdAt)}</span></div><Link href={`/gifts/${offer.virtualGiftId}`} className="mt-1.5 block truncate text-[11px] font-semibold">{offer.baseName} #{offer.number}</Link><p className="mt-0.5 truncate text-[8px] text-[var(--muted)]">{tab === "incoming" ? `Покупатель: ${offer.buyerName}` : `Владелец: ${offer.ownerName}`}{offer.expiresAt ? ` · до ${new Date(offer.expiresAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}` : ""}</p></div><div className="mxm-order-value"><small>Предложение</small><strong><Gem size={10} fill="currentColor" />{money(offer.amount)}</strong></div><div className="mxm-order-actions">{tab === "incoming" ? <><button disabled={busy !== null} onClick={() => void act(offer.id, "reject")} className="mxm-secondary-action !min-h-8 !px-2.5">{busy === `${offer.id}reject` ? "…" : "Отклонить"}</button><button disabled={busy !== null} onClick={() => void act(offer.id, "accept")} className="mxm-primary-action !min-h-8 !px-3">{busy === `${offer.id}accept` ? "Принимаем…" : "Принять"}</button></> : <button disabled={busy !== null} onClick={() => void act(offer.id, "cancel")} className="mxm-secondary-action !min-h-8 !px-2.5">{busy === `${offer.id}cancel` ? "Отменяем…" : "Отменить"}</button>}</div></article>)}</div>
      ) : <Empty text={tab === "incoming" ? "Новых предложений нет" : "Исходящих предложений нет"} detail={tab === "incoming" ? "Когда покупатель предложит цену, заявка появится здесь." : "Предлагайте цену на карточке интересующего подарка."} icon={<Inbox />} action={<Link href="/market" className="mxm-secondary-action">Перейти на рынок</Link>} />}
    </div>
  );
}
function Tab({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) { return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`mxm-segment-button ${active ? "is-active" : ""}`}><span>{label}</span><span className={`shrink-0 text-[9px] ${active ? "text-white" : "text-[var(--muted-2)]"}`}>{count}</span></button>; }
function OrdersMetric({ icon, label, value, detail, tone = "neutral" }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: "neutral" | "attention" }) { return <article className={tone === "attention" ? "is-attention" : ""}><span>{icon}</span><div className="min-w-0"><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>; }
function Empty({ text, detail, icon, action }: { text: string; detail: string; icon: React.ReactNode; action?: React.ReactNode }) { return <div className="mxm-empty-state rounded-[16px] border border-[var(--border-soft)]"><span className="mxm-empty-icon">{icon}</span><p className="font-medium text-white">{text}</p><small className="mt-1 max-w-sm text-[8px] leading-4 text-[var(--muted-2)]">{detail}</small>{action ? <div className="mt-3">{action}</div> : null}</div>; }
