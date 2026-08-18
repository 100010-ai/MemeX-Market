import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-[inset_0_1px_0_rgba(255,255,255,.02)] ${className}`}>{children}</section>;
}

export function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-[-.01em] md:text-xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-xs text-[var(--muted)] md:text-sm">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3.5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,.02)]">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <div className="mt-1 text-base font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-[var(--muted)]">{hint}</div> : null}
    </div>
  );
}

export function CoinAvatar({ symbol, size = "md" }: { symbol: string; size?: "sm" | "md" | "lg" }) {
  const sizes = size === "sm" ? "h-8 w-8 text-[10px]" : size === "lg" ? "h-12 w-12 text-sm" : "h-10 w-10 text-xs";
  return <span className={`grid shrink-0 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,.025)] ${sizes}`}>{symbol.slice(0, 4)}</span>;
}

export function PrimaryButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[#151515] transition hover:bg-[var(--accent-hover)] active:scale-[.985] disabled:opacity-40 ${className}`}>{children}</button>;
}

export function SecondaryButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-sm text-[var(--text)] transition hover:bg-[var(--panel-3)] active:scale-[.985] disabled:opacity-40 ${className}`}>{children}</button>;
}

export function Chip({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return <span className={`inline-flex h-9 items-center rounded-2xl border px-3 text-xs ${active ? "border-[rgba(255,216,61,.44)] bg-[rgba(255,216,61,.08)] text-[var(--accent)]" : "border-[var(--border)] bg-[var(--panel-2)] text-[#b8c0c9]"}`}>{children}</span>;
}
