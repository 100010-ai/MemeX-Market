import Image from "next/image";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`mxm-card mxm-surface-block ${className}`}>{children}</section>;
}

export function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3 border-b border-[var(--border-soft)] pb-3">
      <div className="min-w-0">
        <h1 className="truncate text-[15px] font-semibold tracking-[-.025em] md:text-base">{title}</h1>
        {subtitle ? <p className="mt-1 text-[10px] text-[var(--muted)] md:text-xs">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="border-l border-[var(--border-soft)] px-3.5 py-1 first:border-l-0 first:pl-0">
      <p className="text-[9px] uppercase tracking-[.08em] text-[var(--muted-2)]">{label}</p>
      <div className="mt-1 text-sm font-semibold tracking-[-.015em]">{value}</div>
      {hint ? <div className="mt-1 text-[9px] text-[var(--muted)]">{hint}</div> : null}
    </div>
  );
}

export function CoinAvatar({ symbol, imageUrl = null, size = "md" }: { symbol: string; imageUrl?: string | null; size?: "sm" | "md" | "lg" }) {
  const sizes = size === "sm" ? "h-7 w-7 text-[9px]" : size === "lg" ? "h-10 w-10 text-xs" : "h-8 w-8 text-[10px]";
  const pixels = size === "sm" ? 28 : size === "lg" ? 40 : 32;
  if (imageUrl) return <Image src={imageUrl} alt={`${symbol} logo`} width={pixels} height={pixels} unoptimized loading="lazy" decoding="async" className={`shrink-0 rounded-full object-cover ${sizes}`} />;
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-white/[.035] font-semibold tracking-[-.03em] text-[#c8cdd3] ring-1 ring-white/[.06] ${sizes}`}>{symbol.slice(0, 4)}</span>;
}

export function PrimaryButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`mxm-primary-action mxm-pressable ${className}`}>{children}</button>;
}

export function SecondaryButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`mxm-secondary-action mxm-pressable ${className}`}>{children}</button>;
}

export function Chip({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return <span className={`inline-flex h-7 items-center border-b px-0.5 text-[10px] ${active ? "border-white text-white" : "border-transparent text-[#9098a1]"}`}>{children}</span>;
}

export function IconButton({ className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`mxm-icon-action mxm-pressable ${className}`}>{children}</button>;
}

export function InlineNotice({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "error" | "success"; className?: string }) {
  return <div className={`mxm-inline-notice is-${tone} ${className}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

export function CompactEmpty({ icon, title, action, className = "" }: { icon?: ReactNode; title: string; action?: ReactNode; className?: string }) {
  return <div className={`mxm-empty-state ${className}`}>{icon ? <span className="mxm-empty-icon">{icon}</span> : null}<p>{title}</p>{action ? <div className="mt-3">{action}</div> : null}</div>;
}
