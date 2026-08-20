"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Gem, Layers3, RefreshCw, X } from "lucide-react";
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

function scopeLabel(offer: Offer) {
  if (offer.scopeType === "collection") return "Любой Gift коллекции";
  if (offer.scopeType === "model") return `Модель · ${offer.traitValue || "—"}`;
  if (offer.scopeType === "backdrop") return `Фон · ${offer.traitValue || "—"}`;
  return `Символ · ${offer.traitValue || "—"}`;
}

function makeKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  const [payload, setPayload] = useState<OfferPayload>({ outgoing: [], market: [] });
  const [scopeType, setScopeType] = useState<ScopeType>("collection");
  const [traitValue, setTraitValue] = useState("");
  const [amount, setAmount] = useState("");
  const [maxFills, setMaxFills] = useState(1);
  const [durationHours, setDurationHours] = useState(72);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const values = useMemo(() => {
    if (scopeType === "model") return models.map((item) => item.name);
    if (scopeType === "backdrop") return backdrops.map((item) => item.name);
    if (scopeType === "symbol") return symbols.map((item) => item.name);
    return [];
  }, [scopeType, models, backdrops, symbols]);

  useEffect(() => {
    if (scopeType === "collection") setTraitValue("");
    else if (!values.includes(traitValue)) setTraitValue(values[0] || "");
  }, [scopeType, values, traitValue]);

  const load = useCallback(async () => {
    try {
      const next = await apiFetch<OfferPayload>(`/api/market/offers?baseName=${encodeURIComponent(baseName)}`, { cacheMs: 0 });
      setPayload(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить офферы");
    }
  }, [baseName]);

  useEffect(() => { void load(); }, [load]);

  async function createOffer() {
    const price = Number(amount);
    if (!Number.isFinite(price) || price <= 0) { setError("Укажите корректную цену оффера"); return; }
    if (scopeType !== "collection" && !traitValue) { setError("Выберите trait"); return; }
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/market/offers", {
        method: "POST",
        headers: { "x-idempotency-key": `advanced-offer-${makeKey()}` },
        body: JSON.stringify({ baseName, scopeType, traitValue: scopeType === "collection" ? null : traitValue, amount: price, maxFills, durationHours }),
      });
      setAmount("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать оффер");
    } finally { setBusy(false); }
  }

  async function cancelOffer(id: string) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/market/offers/${id}`, { method: "POST", body: JSON.stringify({ action: "cancel" }) });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отменить оффер");
    } finally { setBusy(false); }
  }

  const activeOutgoing = payload.outgoing.filter((offer) => offer.status === "active" && new Date(offer.expiresAt).getTime() > Date.now());
  const topMarket = payload.market.slice(0, 10);

  return (
    <section className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-3 py-3">
        <div><p className="flex items-center gap-1.5 text-xs font-medium"><Layers3 size={13} />Расширенные офферы</p><p className="mt-1 text-[9px] text-[var(--muted)]">На коллекцию или конкретный trait. Средства резервируются сервером.</p></div>
        <button type="button" onClick={() => void load()} aria-label="Обновить" className="grid h-8 w-8 place-items-center text-[var(--muted)]"><RefreshCw size={13} /></button>
      </div>
      <div className="p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={scopeType} onChange={(event) => setScopeType(event.target.value as ScopeType)} className="mxm-input">
            <option value="collection">Вся коллекция</option><option value="model">Модель</option><option value="backdrop">Фон</option><option value="symbol">Символ</option>
          </select>
          {scopeType === "collection" ? <div className="mxm-input flex items-center text-[var(--muted)]">Любой {baseName}</div> : <select value={traitValue} onChange={(event) => setTraitValue(event.target.value)} className="mxm-input">{values.map((value) => <option key={value} value={value}>{value}</option>)}</select>}
        </div>
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_80px_92px] gap-2">
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="Цена за 1 Gift" className="mxm-input" />
          <select value={maxFills} onChange={(event) => setMaxFills(Number(event.target.value))} className="mxm-input px-2"><option value={1}>1 шт.</option><option value={2}>2 шт.</option><option value={5}>5 шт.</option><option value={10}>10 шт.</option></select>
          <select value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))} className="mxm-input px-2"><option value={24}>24 ч</option><option value={72}>3 дня</option><option value={168}>7 дней</option><option value={336}>14 дней</option></select>
        </div>
        <button type="button" disabled={busy} onClick={() => void createOffer()} className="mt-2 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-[16px] bg-[var(--accent)] px-3 text-[11px] font-semibold text-black disabled:opacity-50"><Gem size={12} fill="currentColor" />Создать оффер</button>
        {error ? <p className="mt-2 text-[10px] text-[var(--negative)]">{error}</p> : null}
      </div>
      {activeOutgoing.length ? <div className="border-t border-[var(--border-soft)]"><p className="px-3 pt-3 text-[9px] uppercase tracking-[.1em] text-[var(--muted)]">Мои активные</p><div className="divide-y divide-[var(--border-soft)]">{activeOutgoing.map((offer) => <div key={offer.id} className="flex items-center gap-2 px-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-[11px]">{scopeLabel(offer)}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{offer.filledCount}/{offer.maxFills} исполнено</p></div><span className="flex items-center gap-1 text-xs font-medium"><Gem size={10} fill="currentColor" />{money(offer.amount)}</span><button type="button" disabled={busy} onClick={() => void cancelOffer(offer.id)} aria-label="Отменить оффер" className="grid h-8 w-8 place-items-center text-[var(--muted)]"><X size={13} /></button></div>)}</div></div> : null}
      <div className="border-t border-[var(--border-soft)]"><p className="px-3 pt-3 text-[9px] uppercase tracking-[.1em] text-[var(--muted)]">Лучшие офферы рынка</p>{topMarket.length ? <div className="divide-y divide-[var(--border-soft)]">{topMarket.map((offer) => <div key={offer.id} className="flex items-center justify-between gap-3 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-[11px]">{scopeLabel(offer)}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{offer.buyerName || "Пользователь"} · осталось {Math.max(0, offer.maxFills - offer.filledCount)}</p></div><span className="flex shrink-0 items-center gap-1 text-xs font-medium"><Gem size={10} fill="currentColor" />{money(offer.amount)}</span></div>)}</div> : <p className="p-4 text-center text-[10px] text-[var(--muted)]">Активных офферов пока нет.</p>}</div>
    </section>
  );
}
