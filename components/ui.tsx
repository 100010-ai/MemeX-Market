import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[16px] border border-[var(--border)] bg-[var(--panel)] shadow-[inset_0_1px_0_rgba(255,255,255,.02)] ${className}`}>{children}</section>;
}

export function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold tracking-[-.01em] md:text-base">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-[10px] text-[var(--muted)] md:text-xs">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-[16px] border border-[var(--border)] bg-[var(--panel)] px-3.5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,.02)]">
      <p className="text-[10px] text-[var(--muted)]">{label}</p>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-[10px] text-[var(--muted)]">{hint}</div> : null}
    </div>
  );
}

export function CoinAvatar({ symbol, imageUrl = null, size = "md" }: { symbol: string; imageUrl?: string | null; size?: "sm" | "md" | "lg" }) {
  const sizes = size === "sm" ? "h-7 w-7 text-[9px]" : size === "lg" ? "h-10 w-10 text-xs" : "h-8 w-8 text-[10px]";
  if (imageUrl) return <img src={imageUrl} alt={`${symbol} logo`} loading="lazy" decoding="async" className={`shrink-0 rounded-[12px] object-cover ${sizes}`} />;
  return <span className={`inline-flex shrink-0 items-center justify-center font-semibold tracking-[-.03em] text-[#c8cdd3] ${sizes}`}>{symbol.slice(0, 4)}</span>;
}

export function PrimaryButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`rounded-[15px] bg-[var(--accent)] px-3.5 py-2.5 text-xs font-semibold text-[#151515] transition hover:bg-[var(--accent-hover)] active:scale-[.985] disabled:opacity-40 ${className}`}>{children}</button>;
}

export function SecondaryButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`rounded-[15px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-xs text-[var(--text)] transition hover:bg-[var(--panel-3)] active:scale-[.985] disabled:opacity-40 ${className}`}>{children}</button>;
}

export function Chip({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return <span className={`inline-flex h-7 items-center border-b px-1 text-[10px] ${active ? "border-[var(--accent)] text-white" : "border-transparent text-[#9098a1]"}`}>{children}</span>;
}
