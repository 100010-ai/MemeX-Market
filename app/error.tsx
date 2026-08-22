"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[56vh] max-w-md items-center px-3">
      <div className="w-full rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,.02)]">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--panel-2)] text-[var(--negative)]"><AlertTriangle size={19} /></span>
        <h1 className="mt-4 text-base font-semibold">Что-то не загрузилось</h1>
        <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">Попробуй ещё раз.</p>
        {process.env.NODE_ENV !== "production" && error.message ? <p className="mt-2 line-clamp-2 font-mono text-[9px] text-[var(--muted-2)]">{error.message}</p> : null}
        <button onClick={reset} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--panel-2)] py-2.5 text-xs font-medium transition active:scale-[.985]"><RotateCcw size={14} />Повторить</button>
      </div>
    </div>
  );
}
