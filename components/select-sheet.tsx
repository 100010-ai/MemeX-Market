"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type SelectOption = { value: string; label: string; hint?: string };

export function SelectSheet({ label, value, options, onChange, searchable = false, icon }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; searchable?: boolean; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const active = value !== "all";

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((option) => `${option.label} ${option.hint || ""}`.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const overlay = open && typeof document !== "undefined" ? createPortal(
    <div className="mxm-select-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
      <section className="mxm-select-drawer" role="dialog" aria-modal="true" aria-label={label}>
        <header className="mxm-select-header">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold tracking-[-.02em] text-white">{label}</p>
            {active && selected ? <p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">Сейчас: {selected.label}</p> : <p className="mt-0.5 text-[10px] text-[var(--muted)]">Выберите значение</p>}
          </div>
          <button type="button" onClick={() => setOpen(false)} className="mxm-select-close" aria-label="Закрыть"><X size={18} /></button>
        </header>

        {searchable ? (
          <label className="mxm-select-search">
            <Search size={15} className="shrink-0 text-[var(--muted)]" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--muted-2)]" />
            {query ? <button type="button" onClick={() => setQuery("")} className="text-[var(--muted)]" aria-label="Очистить"><X size={14} /></button> : null}
          </label>
        ) : null}

        <div className="mxm-select-options">
          {visible.map((option) => {
            const selectedOption = option.value === value;
            return (
              <button
                type="button"
                key={option.value}
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={`mxm-select-option ${selectedOption ? "is-selected" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{option.label}</p>
                  {option.hint ? <p className="mt-1 truncate text-[10px] text-[var(--muted)]">{option.hint}</p> : null}
                </div>
                {selectedOption ? <Check size={17} className="shrink-0 text-[var(--accent)]" /> : null}
              </button>
            );
          })}
          {!visible.length ? <div className="px-2 py-14 text-center text-[12px] text-[var(--muted)]">Ничего не найдено</div> : null}
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return <>
    <button type="button" onClick={() => { setQuery(""); setOpen(true); }} className={`mxm-filter-chip ${active ? "is-active" : ""}`} aria-expanded={open}>
      {icon}<span className="max-w-[156px] truncate">{active && selected ? selected.label : label}</span><ChevronDown size={12} className="shrink-0 opacity-55" />
    </button>
    {overlay}
  </>;
}
