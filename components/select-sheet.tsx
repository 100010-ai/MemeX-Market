"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type SelectOption = { value: string; label: string; hint?: string };

export function SelectSheet({ label, value, options, onChange, searchable = false, icon }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; searchable?: boolean; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const active = value !== "all";
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((option) => `${option.label} ${option.hint || ""}`.toLowerCase().includes(q)) : options;
  }, [options, query]);

  return <>
    <button type="button" onClick={() => { setQuery(""); setOpen(true); }} className={`mxm-filter-chip ${active ? "is-active" : ""}`}>
      {icon}<span className="max-w-[150px] truncate">{active && selected ? selected.label : label}</span><ChevronDown size={11} className="shrink-0 opacity-65" />
    </button>
    {open ? <div className="mxm-sheet-backdrop fixed inset-0 z-[90] flex items-end justify-center mxm-overlay-backdrop bg-black/72 p-0 md:items-center md:p-5" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
      <div className="mxm-sheet-panel w-full max-w-lg overflow-hidden rounded-t-[26px] border border-[var(--border)] bg-[#0d1116] shadow-[0_-16px_60px_rgba(0,0,0,.45)] md:rounded-[22px]">
        <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-4 py-3.5"><div className="min-w-0 flex-1"><p className="text-[12px] font-semibold">{label}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">Выберите значение</p></div><button onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-[12px] bg-[var(--panel-2)] text-[var(--muted)]"><X size={14}/></button></div>
        {searchable ? <div className="px-3 pt-3"><label className="mxm-search h-10"><Search size={13} className="text-[var(--muted)]"/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Поиск" className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"/></label></div> : null}
        <div className="max-h-[62dvh] overflow-y-auto overscroll-contain p-2.5 pb-[max(12px,env(safe-area-inset-bottom))]">
          {visible.map((option) => <button key={option.value} onClick={() => { onChange(option.value); setOpen(false); }} className={`mb-1 flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition last:mb-0 ${option.value === value ? "bg-[var(--panel-3)]" : "hover:bg-[var(--panel-2)]"}`}><div className="min-w-0 flex-1"><p className="truncate text-[11px]">{option.label}</p>{option.hint ? <p className="mt-0.5 truncate text-[9px] text-[var(--muted)]">{option.hint}</p> : null}</div>{option.value === value ? <Check size={14} className="shrink-0 text-[var(--accent)]"/> : null}</button>)}
          {!visible.length ? <div className="p-6 text-center text-[11px] text-[var(--muted)]">Ничего не найдено</div> : null}
        </div>
      </div>
    </div> : null}
  </>;
}
