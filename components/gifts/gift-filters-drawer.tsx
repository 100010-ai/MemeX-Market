"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, ChevronRight, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";

export type GiftFilterValues = {
  collection: string;
  model: string;
  backdrop: string;
  symbol: string;
  priceBand: string;
  giftSort: string;
};

type Choice = { value: string; label: string; hint?: string };
type FilterKey = keyof GiftFilterValues;

const filterKeys = new Set<FilterKey>(["collection", "model", "backdrop", "symbol", "priceBand", "giftSort"]);

function normalizeFilterKey(value: unknown): FilterKey | null {
  return typeof value === "string" && filterKeys.has(value as FilterKey) ? (value as FilterKey) : null;
}

type Props = {
  open: boolean;
  onClose: () => void;
  values: GiftFilterValues;
  onChange: (key: FilterKey, value: string) => void;
  onReset: () => void;
  collections: string[];
  models: string[];
  backdrops: string[];
  symbols: string[];
};

const priceOptions: Choice[] = [
  { value: "all", label: "Любая цена" },
  { value: "under50", label: "До 50 TON" },
  { value: "50to250", label: "50–250 TON" },
  { value: "250to1000", label: "250–1 000 TON" },
  { value: "over1000", label: "От 1 000 TON" },
];
const sortOptions: Choice[] = [
  { value: "random", label: "Перемешано", hint: "Каждый заход — новая подборка" },
  { value: "price", label: "Сначала дешевле" },
  { value: "newest", label: "Сначала новые" },
  { value: "offers", label: "Больше офферов" },
  { value: "number", label: "По номеру" },
  { value: "rarity", label: "По редкости" },
];

export function GiftFiltersDrawer({ open, onClose, values, onChange, onReset, collections, models, backdrops, symbols }: Props) {
  const [active, setActive] = useState<FilterKey | null>(null);
  const [query, setQuery] = useState("");
  const touchStartY = useRef<number | null>(null);

  function closeDrawer() {
    setActive(null);
    setQuery("");
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (active) { setActive(null); setQuery(""); }
      else { setQuery(""); onClose(); }
    };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", key); };
  }, [open, active, onClose]);

  const sections = useMemo<Record<FilterKey, { label: string; choices: Choice[] }>>(() => ({
    collection: { label: "Коллекция", choices: [{ value: "all", label: "Все коллекции" }, ...collections.map((value): Choice => ({ value, label: value }))] },
    model: { label: "Модель", choices: [{ value: "all", label: "Все модели" }, ...models.map((value): Choice => ({ value, label: value }))] },
    backdrop: { label: "Фон", choices: [{ value: "all", label: "Все фоны" }, ...backdrops.map((value): Choice => ({ value, label: value }))] },
    symbol: { label: "Символ", choices: [{ value: "all", label: "Все символы" }, ...symbols.map((value): Choice => ({ value, label: value }))] },
    priceBand: { label: "Цена", choices: priceOptions },
    giftSort: { label: "Сортировка", choices: sortOptions },
  }), [collections, models, backdrops, symbols]);

  if (!open || typeof document === "undefined") return null;
  const activeKey: FilterKey | null = normalizeFilterKey(active);
  const activeSection = activeKey ? sections[activeKey] : null;
  const q = query.trim().toLowerCase();
  const visible = activeSection ? activeSection.choices.filter((choice) => !q || `${choice.label} ${choice.hint || ""}`.toLowerCase().includes(q)) : [];
  const activeCount = Object.entries(values).filter(([key, value]) => value !== (key === "giftSort" ? "random" : "all")).length;
  const selectedLabel = (key: FilterKey) => sections[key].choices.find((choice) => choice.value === values[key])?.label || sections[key].label;

  return createPortal(
    <div className="mxm-filter-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
      <section className="mxm-filter-drawer" role="dialog" aria-modal="true" aria-label="Фильтры подарков" onTouchStart={(event) => { touchStartY.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={(event) => { const start = touchStartY.current; touchStartY.current = null; if (start == null) return; const end = event.changedTouches[0]?.clientY ?? start; if (end - start > 68 && !active) closeDrawer(); }}>
        <div className="mxm-filter-drawer-handle" />
        <header className="mxm-filter-drawer-head">
          {active ? <button type="button" className="mxm-filter-icon-button" onClick={() => { setActive(null); setQuery(""); }} aria-label="Назад"><ArrowLeft size={18} /></button> : <span className="mxm-filter-title-icon"><SlidersHorizontal size={15} /></span>}
          <div className="min-w-0 flex-1">
            <h2>{activeSection?.label || "Фильтры"}</h2>
            <p>{activeKey ? selectedLabel(activeKey) : activeCount ? `Выбрано: ${activeCount}` : "Настрой выдачу без лишних панелей"}</p>
          </div>
          <button type="button" className="mxm-filter-icon-button" onClick={closeDrawer} aria-label="Закрыть"><X size={18} /></button>
        </header>

        {activeSection ? (
          <>
            {activeSection.choices.length > 10 ? <label className="mxm-filter-drawer-search"><Search size={15} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Поиск: ${activeSection.label.toLowerCase()}`} /></label> : null}
            <div className="mxm-filter-choice-list">
              {visible.map((choice) => {
                const selected = activeKey ? values[activeKey] === choice.value : false;
                return <button key={choice.value} type="button" className={`mxm-filter-choice ${selected ? "is-selected" : ""}`} onClick={() => { if (!activeKey) return; onChange(activeKey, choice.value); setActive(null); setQuery(""); }}>
                  <div className="min-w-0 flex-1"><span>{choice.label}</span>{choice.hint ? <small>{choice.hint}</small> : null}</div>{selected ? <Check size={16} /> : null}
                </button>;
              })}
              {!visible.length ? <p className="mxm-filter-empty">Ничего не найдено</p> : null}
            </div>
          </>
        ) : (
          <>
            <div className="mxm-filter-main-list">
              {(Object.keys(sections) as FilterKey[]).map((key) => {
                const activeValue = values[key] !== (key === "giftSort" ? "random" : "all");
                return <button type="button" key={key} className="mxm-filter-main-row" onClick={() => setActive(key)}>
                  <span>{sections[key].label}</span><span className={`mxm-filter-current ${activeValue ? "is-active" : ""}`}>{selectedLabel(key)}</span><ChevronRight size={15} />
                </button>;
              })}
            </div>
            <footer className="mxm-filter-drawer-footer">
              <button type="button" className="mxm-filter-reset" onClick={() => { onReset(); setQuery(""); }} disabled={!activeCount}><RotateCcw size={13} />Сбросить</button>
              <button type="button" className="mxm-filter-apply" onClick={closeDrawer}>Показать</button>
            </footer>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}
