"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Gem, Layers3, RefreshCw, ShieldCheck, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import type { GiftTraitGroup } from "@/lib/types";

type ScopeType = "collection" | "model" | "backdrop" | "symbol";
type Offer = {
  id: string;
  buyerId: string;
  buyerName: string | null;
  baseName: string;
  scopeType: ScopeType;
  traitValue: string | null;
  amount: number;
  maxFills: number;
  filledCount: number;
  status: string;
  expiresAt: string;
  createdAt: string;
};

type OfferPayload = { outgoing: Offer[]; market: Offer[] };
type LoadedOfferPayload = OfferPayload & { checkedAt: number };

function scopeLabel(offer: Offer) {
  if (offer.scopeType === "collection") return "Любой подарок коллекции";
  if (offer.scopeType === "model") return `Модель · ${offer.traitValue || "—"}`;
  if (offer.scopeType === "backdrop") return `Фон · ${offer.traitValue || "—"}`;
  return `Символ · ${offer.traitValue || "—"}`;
}

function makeKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function timeUntil(value: string) {
  const milliseconds = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "истёк";
  const hours = Math.ceil(milliseconds / 3_600_000);
  return hours < 48 ? `${hours} ч` : `${Math.ceil(hours / 24)} дн`;
}

export function AdvancedOffersPanel({
  baseName,
  models,
  backdrops,
  symbols,
}: {
  baseName: string;
  models: GiftTraitGroup[];
  backdrops: GiftTraitGroup[];
  symbols: GiftTraitGroup[];
}) {
  const [payload, setPayload] = useState<LoadedOfferPayload>({ outgoing: [], market: [], checkedAt: 0 });
  const [scopeType, setScopeType] = useState<ScopeType>("collection");
  const [traitValue, setTraitValue] = useState("");
  const [amount, setAmount] = useState("");
  const [maxFills, setMaxFills] = useState(1);
  const [durationHours, setDurationHours] = useState(72);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const values = useMemo(() => {
    if (scopeType === "model") return models.map((item) => item.name);
    if (scopeType === "backdrop") return backdrops.map((item) => item.name);
    if (scopeType === "symbol") return symbols.map((item) => item.name);
    return [];
  }, [scopeType, models, backdrops, symbols]);

  const selectedTraitValue = scopeType === "collection"
    ? ""
    : values.includes(traitValue) ? traitValue : values[0] || "";

  const load = useCallback(async () => {
    try {
      const next = await apiFetch<OfferPayload>(`/api/market/offers?baseName=${encodeURIComponent(baseName)}`, { cacheMs: 0 });
      setPayload({ ...next, checkedAt: Date.now() });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить предложения");
    }
  }, [baseName]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function createOffer() {
    const price = Number(amount);
    if (!Number.isFinite(price) || price <= 0) { setError("Укажите корректную цену предложения"); return; }
    if (scopeType !== "collection" && !selectedTraitValue) { setError("Выберите характеристику"); return; }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/api/market/offers", {
        method: "POST",
        headers: { "x-idempotency-key": `advanced-offer-${makeKey()}` },
        body: JSON.stringify({ baseName, scopeType, traitValue: scopeType === "collection" ? null : selectedTraitValue, amount: price, maxFills, durationHours }),
      });
      setAmount("");
      await load();
      setNotice(`Предложение создано · резерв ${money(price * maxFills)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать предложение");
    } finally { setBusy(false); }
  }

  async function cancelOffer(id: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/market/offers/${id}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) });
      await load();
      setNotice("Предложение отменено, резерв освобождён");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отменить предложение");
    } finally { setBusy(false); }
  }

  const activeOutgoing = payload.outgoing.filter((offer) => offer.status === "active" && new Date(offer.expiresAt).getTime() > payload.checkedAt);
  const topMarket = payload.market.slice(0, 10);
  const parsedAmount = Number(amount);
  const estimatedReserve = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount * maxFills : null;
  const activeReserve = activeOutgoing.reduce((sum, offer) => sum + offer.amount * Math.max(0, offer.maxFills - offer.filledCount), 0);

  return (
    <section className="mxm-advanced-offers overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-soft)] px-3 py-3">
        <div><p className="flex items-center gap-1.5 text-xs font-medium"><Layers3 size={13} className="text-[var(--accent)]" />Collection bids</p><p className="mt-1 text-[9px] leading-4 text-[var(--muted)]">Поставь цену на всю коллекцию или один trait — владелец подходящего подарка сможет принять её.</p></div>
        <button type="button" disabled={busy} onClick={() => void load()} aria-label="Обновить предложения" className="grid h-9 w-9 shrink-0 place-items-center rounded-[14px] bg-[var(--panel-2)] text-[var(--muted)]"><RefreshCw size={13} className={busy ? "animate-spin" : ""} /></button>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(300px,.85fr)]">
        <div className="p-3 lg:border-r lg:border-[var(--border-soft)]">
          <div className="grid gap-2 sm:grid-cols-2">
            <label><span className="mb-1.5 block text-[9px] text-[var(--muted)]">Охват предложения</span><select value={scopeType} onChange={(event) => setScopeType(event.target.value as ScopeType)} className="mxm-input"><option value="collection">Вся коллекция</option><option value="model">Модель</option><option value="backdrop">Фон</option><option value="symbol">Символ</option></select></label>
            <label><span className="mb-1.5 block text-[9px] text-[var(--muted)]">Что подходит</span>{scopeType === "collection" ? <div className="mxm-input flex min-h-10 items-center text-[var(--muted)]">Любой {baseName}</div> : <select value={selectedTraitValue} onChange={(event) => setTraitValue(event.target.value)} className="mxm-input">{values.map((value) => <option key={value} value={value}>{value}</option>)}</select>}</label>
          </div>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_84px_94px] gap-2">
            <label className="min-w-0"><span className="mb-1.5 block text-[9px] text-[var(--muted)]">Цена за один</span><input aria-label="Цена предложения за подарок" value={amount} onChange={(event) => setAmount(event.target.value.replace(",", "."))} inputMode="decimal" placeholder="0.00 TON" className="mxm-input w-full" /></label>
            <label><span className="mb-1.5 block text-[9px] text-[var(--muted)]">Количество</span><select value={maxFills} onChange={(event) => setMaxFills(Number(event.target.value))} className="mxm-input w-full px-2"><option value={1}>1 шт.</option><option value={2}>2 шт.</option><option value={5}>5 шт.</option><option value={10}>10 шт.</option></select></label>
            <label><span className="mb-1.5 block text-[9px] text-[var(--muted)]">Срок</span><select value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))} className="mxm-input w-full px-2"><option value={24}>24 часа</option><option value={72}>3 дня</option><option value={168}>7 дней</option><option value={336}>14 дней</option></select></label>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-[15px] bg-[var(--panel-2)] px-3 py-2.5"><div><p className="text-[8px] text-[var(--muted)]">Резерв при создании</p><p className="mt-1 flex items-center gap-1 text-xs font-semibold"><Gem size={10} className="text-[var(--accent)]" fill="currentColor" />{estimatedReserve == null ? "—" : money(estimatedReserve)}</p></div><div className="flex max-w-[210px] items-start gap-1.5 text-right text-[8px] leading-4 text-[var(--muted)]"><span>Исполнение и резерв контролирует сервер</span><ShieldCheck size={12} className="mt-0.5 shrink-0 text-[var(--positive)]" /></div></div>
          <button type="button" disabled={busy || estimatedReserve == null} onClick={() => void createOffer()} className="mt-2 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[16px] bg-[var(--accent)] px-3 text-[11px] font-semibold text-black disabled:opacity-40"><Gem size={12} fill="currentColor" />{busy ? "Сохраняем…" : "Создать и зарезервировать"}</button>
          {error ? <p role="alert" className="mt-2 text-[10px] text-[var(--negative)]">{error}</p> : null}
          {notice ? <p aria-live="polite" className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--positive)]"><CheckCircle2 size={12} />{notice}</p> : null}
        </div>
        <div className="min-w-0 border-t border-[var(--border-soft)] lg:border-t-0">
          <div className="flex items-center justify-between px-3 pt-3"><p className="text-[9px] uppercase tracking-[.1em] text-[var(--muted)]">Мои активные · {activeOutgoing.length}</p><span className="text-[9px] text-[var(--muted)]">Резерв {money(activeReserve)}</span></div>
          {activeOutgoing.length ? <div className="mt-1 divide-y divide-[var(--border-soft)]">{activeOutgoing.map((offer) => <div key={offer.id} className="flex items-center gap-2 px-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-[11px]">{scopeLabel(offer)}</p><p className="mt-0.5 flex items-center gap-1 text-[9px] text-[var(--muted)]"><Clock3 size={9} />{timeUntil(offer.expiresAt)} · {offer.filledCount}/{offer.maxFills} исполнено</p></div><span className="flex items-center gap-1 text-xs font-medium"><Gem size={10} fill="currentColor" />{money(offer.amount)}</span><button type="button" disabled={busy} onClick={() => void cancelOffer(offer.id)} aria-label="Отменить предложение" className="grid h-9 w-9 place-items-center rounded-[14px] bg-[var(--panel-2)] text-[var(--muted)]"><X size={13} /></button></div>)}</div> : <p className="px-3 py-4 text-[10px] text-[var(--muted)]">Нет активных резервов по этой коллекции.</p>}
          <div className="border-t border-[var(--border-soft)]"><p className="px-3 pt-3 text-[9px] uppercase tracking-[.1em] text-[var(--muted)]">Лучшие предложения рынка</p>{topMarket.length ? <div className="mt-1 max-h-60 divide-y divide-[var(--border-soft)] overflow-y-auto">{topMarket.map((offer) => <div key={offer.id} className="flex items-center justify-between gap-3 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-[11px]">{scopeLabel(offer)}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{offer.buyerName || "Пользователь"} · осталось {Math.max(0, offer.maxFills - offer.filledCount)}</p></div><span className="flex shrink-0 items-center gap-1 text-xs font-medium"><Gem size={10} fill="currentColor" />{money(offer.amount)}</span></div>)}</div> : <p className="p-4 text-center text-[10px] text-[var(--muted)]">Активных предложений пока нет.</p>}</div>
        </div>
      </div>
    </section>
  );
}
