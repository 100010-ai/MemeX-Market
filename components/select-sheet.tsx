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
    <button type="button" onClick={() => { setQuery(""); setOpen(true); }} className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[12px] border px-2.5 text-[11px] transition active:scale-[.985] ${active ? "border-[#4b5056] text-white" : "border-[var(--border)] bg-transparent text-[#b7bcc2]"}`}>
      {icon}<span className="max-w-[150px] truncate">{active && selected ? selected.label : label}</span><ChevronDown size={11} className="shrink-0 text-[var(--muted)]" />
    </button>
    {open ? <div className="mxm-sheet-backdrop fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-0 backdrop-blur-[3px] md:items-center md:p-5" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
      <div className="mxm-sheet-panel w-full max-w-lg overflow-hidden rounded-t-[28px] border border-[var(--border)] bg-[#0b0e11] shadow-[0_-16px_60px_rgba(0,0,0,.45)] md:rounded-[24px]">
        <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-3.5 py-3"><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{label}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">Выберите значение</p></div><button onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-[14px] bg-[var(--panel-2)] text-[var(--muted)]"><X size={14}/></button></div>
        {searchable ? <div className="px-3 pt-3"><label className="flex h-9 items-center gap-2 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] px-3"><Search size={13} className="text-[var(--muted)]"/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Поиск" className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"/></label></div> : null}
        <div className="max-h-[62dvh] overflow-y-auto overscroll-contain p-2.5 pb-[max(12px,env(safe-area-inset-bottom))]">
          {visible.map((option) => <button key={option.value} onClick={() => { onChange(option.value); setOpen(false); }} className={`mb-1 flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition last:mb-0 ${option.value === value ? "bg-[var(--panel-3)]" : "hover:bg-[var(--panel-2)]"}`}><div className="min-w-0 flex-1"><p className="truncate text-xs">{option.label}</p>{option.hint ? <p className="mt-0.5 truncate text-[9px] text-[var(--muted)]">{option.hint}</p> : null}</div>{option.value === value ? <Check size={14} className="shrink-0 text-[var(--accent)]"/> : null}</button>)}
          {!visible.length ? <div className="p-6 text-center text-[11px] text-[var(--muted)]">Ничего не найдено</div> : null}
        </div>
      </div>
    </div> : null}
  </>;
}
