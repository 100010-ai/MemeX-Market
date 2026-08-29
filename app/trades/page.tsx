"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Check, Clock3, Gem, Handshake, Plus, RefreshCw, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { GiftMedia } from "@/components/gifts/gift-media";
import { useTelegramProfile } from "@/components/telegram-provider";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import type { GiftAsset } from "@/lib/types";

type TradeOffer = {
  id: string;
  direction: "incoming" | "outgoing";
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  offeredGift: GiftAsset;
  requestedGift: GiftAsset;
  topupAmount: number;
  status: string;
  note: string | null;
  expiresAt: string;
  createdAt: string;
};
type Payload = { incoming: TradeOffer[]; outgoing: TradeOffer[]; myGifts: GiftAsset[]; requestedGift: GiftAsset | null };
type Tab = "incoming" | "outgoing" | "new";

function remaining(value: string) {
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "истёк";
  const hours = Math.ceil(ms / 3_600_000);
  return hours < 24 ? `${hours} ч` : `${Math.ceil(hours / 24)} дн`;
}

export default function TradesPage() {
  const searchParams = useSearchParams();
  const requestedGiftId = searchParams.get("requestedGiftId") || "";
  const { refreshProfile, haptic } = useTelegramProfile();
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<Tab>(requestedGiftId ? "new" : "incoming");
  const [targetGiftId, setTargetGiftId] = useState(requestedGiftId);
  const [offeredGiftId, setOfferedGiftId] = useState("");
  const [topup, setTopup] = useState("");
  const [durationHours, setDurationHours] = useState(72);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const suffix = requestedGiftId ? `?requestedGiftId=${encodeURIComponent(requestedGiftId)}` : "";
      const payload = await apiFetch<Payload>(`/api/trade-offers${suffix}`, { cacheMs: 0, dedupe: false });
      setData(payload);
      if (requestedGiftId && payload.requestedGift) setTargetGiftId(payload.requestedGift.virtualGiftId);
      if (!offeredGiftId) {
        const candidate = payload.myGifts.find((gift) => gift.virtualGiftId !== (payload.requestedGift?.virtualGiftId || targetGiftId));
        if (candidate) setOfferedGiftId(candidate.virtualGiftId);
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить Trade Center");
    } finally { setLoading(false); }
  }, [requestedGiftId, offeredGiftId, targetGiftId]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const activeIncoming = useMemo(() => (data?.incoming || []).filter((offer) => offer.status === "active"), [data]);
  const activeOutgoing = useMemo(() => (data?.outgoing || []).filter((offer) => offer.status === "active"), [data]);
  const selectedOffered = data?.myGifts.find((gift) => gift.virtualGiftId === offeredGiftId) || null;
  const selectedTarget = data?.requestedGift?.virtualGiftId === targetGiftId ? data.requestedGift : null;

  async function resolveOffer(id: string, action: "accept" | "decline" | "cancel") {
    if (busy) return;
    setBusy(`${action}:${id}`); setError(null); setNotice(null); haptic("medium");
    try {
      await apiFetch(`/api/trade-offers/${id}`, { method: "POST", body: JSON.stringify({ action }) });
      await Promise.all([load(), refreshProfile()]);
      haptic("heavy");
      setNotice(action === "accept" ? "Обмен выполнен" : action === "decline" ? "Предложение отклонено" : "Предложение отменено");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось обработать предложение"); }
    finally { setBusy(null); }
  }

  async function createOffer() {
    if (busy) return;
    if (!targetGiftId) { setError("Откройте подарок и нажмите «Предложить обмен»"); return; }
    if (!offeredGiftId) { setError("Выберите подарок для обмена"); return; }
    const topupAmount = topup.trim() ? Number(topup.replace(",", ".")) : 0;
    if (!Number.isFinite(topupAmount) || topupAmount < 0) { setError("Некорректная доплата"); return; }
    setBusy("create"); setError(null); setNotice(null); haptic("medium");
    try {
      await apiFetch("/api/trade-offers", { method: "POST", body: JSON.stringify({ requestedGiftId: targetGiftId, offeredGiftId, topupAmount, durationHours, note }) });
      setTopup(""); setNote(""); setTab("outgoing");
      await Promise.all([load(), refreshProfile()]);
      haptic("heavy"); setNotice("Trade Offer отправлен");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось отправить обмен"); }
    finally { setBusy(null); }
  }

  return <div className="mx-auto max-w-4xl">
    <header className="mb-4 flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.13em] text-[var(--muted-2)]">MXM P2P</p><h1 className="mt-1 flex items-center gap-2 text-lg font-semibold"><Handshake size={18} />Trade Center</h1><p className="mt-1 max-w-xl text-[11px] leading-5 text-[var(--muted)]">Меняйте один подарок на другой и добавляйте доплату. Обмен исполняется одной серверной транзакцией.</p></div><button type="button" onClick={() => void load()} aria-label="Обновить" className="grid h-10 w-10 place-items-center rounded-[14px] bg-[var(--panel-2)] text-[var(--muted)]"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button></header>

    <div className="mb-3 grid grid-cols-3 gap-2">{([['incoming',`Входящие · ${activeIncoming.length}`],['outgoing',`Исходящие · ${activeOutgoing.length}`],['new','Новый обмен']] as const).map(([key,label]) => <button key={key} type="button" onClick={() => setTab(key)} className={`min-h-11 rounded-[15px] px-2 text-[11px] font-medium ${tab === key ? "bg-white text-black" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}>{label}</button>)}</div>
    {error ? <div className="mxm-alert mxm-alert-error mb-3">{error}</div> : null}
    {notice ? <div className="mxm-alert mb-3 border-[rgba(85,225,190,.2)] bg-[rgba(85,225,190,.06)] text-[var(--positive)]">{notice}</div> : null}

    {tab === "incoming" ? <OfferList offers={activeIncoming} empty="Входящих обменов пока нет" busy={busy} incoming onAction={resolveOffer} /> : null}
    {tab === "outgoing" ? <OfferList offers={activeOutgoing} empty="Активных исходящих обменов нет" busy={busy} onAction={resolveOffer} /> : null}
    {tab === "new" ? <section className="rounded-[20px] border border-[var(--border)] bg-[var(--panel)] p-3 sm:p-4">
      {!data?.requestedGift ? <div className="rounded-[16px] bg-[var(--panel-2)] p-4 text-center"><ArrowLeftRight size={20} className="mx-auto text-[var(--accent)]" /><p className="mt-2 text-xs font-medium">Выберите цель обмена</p><p className="mt-1 text-[10px] leading-5 text-[var(--muted)]">Откройте любой чужой подарок в маркете и нажмите «Предложить обмен».</p><Link href="/market?tab=gifts" className="mxm-primary-action mt-3 inline-flex">Открыть подарки</Link></div> : <>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center"><GiftBox gift={selectedOffered} label="Вы отдаёте" /><ArrowLeftRight size={18} className="mx-auto rotate-90 text-[var(--muted)] sm:rotate-0" /><GiftBox gift={data.requestedGift} label="Вы получаете" /></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2"><label className="text-[9px] text-[var(--muted)]">Ваш подарок<select value={offeredGiftId} onChange={(event) => setOfferedGiftId(event.target.value)} className="mxm-input mt-1 w-full"><option value="">Выберите подарок</option>{data.myGifts.filter((gift) => gift.virtualGiftId !== data.requestedGift?.virtualGiftId && !gift.isBurned).map((gift) => <option key={gift.virtualGiftId} value={gift.virtualGiftId}>{gift.baseName} #{gift.number} · {gift.modelName}</option>)}</select></label><label className="text-[9px] text-[var(--muted)]">Доплата<input value={topup} onChange={(event) => setTopup(event.target.value)} inputMode="decimal" placeholder="0" className="mxm-input mt-1 w-full" /></label><label className="text-[9px] text-[var(--muted)]">Срок<select value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))} className="mxm-input mt-1 w-full"><option value={24}>24 часа</option><option value={72}>3 дня</option><option value={168}>7 дней</option><option value={336}>14 дней</option></select></label><label className="text-[9px] text-[var(--muted)]">Комментарий<input value={note} maxLength={240} onChange={(event) => setNote(event.target.value)} placeholder="Необязательно" className="mxm-input mt-1 w-full" /></label></div>
        <div className="mt-3 rounded-[14px] bg-[var(--panel-2)] p-3 text-[9px] leading-5 text-[var(--muted)]"><Gem size={11} className="mr-1 inline" />Доплата резервируется до принятия, отмены или истечения предложения. Подарки проверяются повторно в момент принятия.</div>
        <button type="button" disabled={busy != null || !selectedOffered} onClick={() => void createOffer()} className="mxm-primary-action mt-3 min-h-11 w-full justify-center"><Plus size={14} />{busy === "create" ? "Отправляем…" : "Отправить Trade Offer"}</button>
      </>}
    </section> : null}
  </div>;
}

function GiftBox({ gift, label }: { gift: GiftAsset | null; label: string }) { return <div className="rounded-[18px] bg-[var(--panel-2)] p-2.5"><p className="mb-2 text-[9px] uppercase tracking-[.09em] text-[var(--muted)]">{label}</p>{gift ? <div className="flex items-center gap-2.5"><div className="h-16 w-16 shrink-0 overflow-hidden rounded-[14px]"><GiftMedia gift={gift} compact className="h-full w-full" /></div><div className="min-w-0"><p className="truncate text-xs font-semibold">{gift.baseName} #{gift.number}</p><p className="mt-1 truncate text-[9px] text-[var(--muted)]">{gift.modelName} · {gift.backdropName}</p><p className="mt-1 text-[9px]">{money(gift.estimatedValue || gift.referencePrice || gift.acquiredPrice)}</p></div></div> : <div className="grid h-16 place-items-center text-[10px] text-[var(--muted)]">Выберите подарок</div>}</div>; }

function OfferList({ offers, empty, busy, incoming = false, onAction }: { offers: TradeOffer[]; empty: string; busy: string | null; incoming?: boolean; onAction: (id: string, action: "accept" | "decline" | "cancel") => Promise<void> }) {
  if (!offers.length) return <div className="rounded-[20px] border border-[var(--border)] bg-[var(--panel)] p-10 text-center text-[11px] text-[var(--muted)]">{empty}</div>;
  return <div className="space-y-2">{offers.map((offer) => <article key={offer.id} className="rounded-[20px] border border-[var(--border)] bg-[var(--panel)] p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold">{incoming ? offer.senderName : offer.recipientName}</p><p className="mt-0.5 flex items-center gap-1 text-[9px] text-[var(--muted)]"><Clock3 size={10} />ещё {remaining(offer.expiresAt)}</p></div>{offer.topupAmount > 0 ? <span className="rounded-[12px] bg-[rgba(139,164,255,.1)] px-2 py-1 text-[10px] text-[var(--accent)]">+ {money(offer.topupAmount)}</span> : null}</div><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center"><GiftBox gift={offer.offeredGift} label={incoming ? "Вам предлагают" : "Вы отдаёте"} /><ArrowLeftRight size={17} className="mx-auto rotate-90 text-[var(--muted)] sm:rotate-0" /><GiftBox gift={offer.requestedGift} label={incoming ? "За ваш" : "Вы получаете"} /></div>{offer.note ? <p className="mt-2 rounded-[12px] bg-[var(--panel-2)] px-3 py-2 text-[9px] text-[var(--muted)]">{offer.note}</p> : null}<div className="mt-3 flex gap-2">{incoming ? <><button type="button" disabled={busy != null} onClick={() => void onAction(offer.id,"accept")} className="mxm-primary-action flex-1 justify-center"><Check size={13} />Принять</button><button type="button" disabled={busy != null} onClick={() => void onAction(offer.id,"decline")} className="mxm-secondary-action flex-1 justify-center"><X size={13} />Отклонить</button></> : <button type="button" disabled={busy != null} onClick={() => void onAction(offer.id,"cancel")} className="mxm-secondary-action w-full justify-center"><X size={13} />Отменить предложение</button>}</div></article>)}</div>;
}
