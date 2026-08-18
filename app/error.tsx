"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[56vh] max-w-md items-center px-3">
      <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--panel-2)] text-[var(--negative)]"><AlertTriangle size={18} /></span>
        <h1 className="mt-3 text-base font-semibold">MXM request failed</h1>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{error.message || "The page could not finish loading."}</p>
        {error.digest ? <p className="mt-2 font-mono text-[9px] text-[var(--muted-2)]">digest {error.digest}</p> : null}
        <button onClick={reset} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--panel-3)] py-2.5 text-xs font-medium"><RotateCcw size={14} />Retry request</button>
      </div>
    </div>
  );
}
