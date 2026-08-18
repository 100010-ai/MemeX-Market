"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Gamepad2, Gem, ListChecks, Menu, Megaphone, ReceiptText, Store, UserRound, WalletCards } from "lucide-react";
import { useTelegramProfile } from "@/components/telegram-provider";
import { money } from "@/lib/format";

const nav = [
  { href: "/market", label: "Market", icon: Store },
  { href: "/orders", label: "Orders", icon: ReceiptText },
  { href: "/hub", label: "Hub", icon: Gamepad2 },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/vault", label: "Vault", icon: Boxes },
];

function ProfileAvatar({ photoUrl, size = "sm" }: { photoUrl: string | null; size?: "sm" | "md" }) {
  const cls = size === "md" ? "h-10 w-10 rounded-xl" : "h-8 w-8 rounded-lg";
  if (photoUrl) return <img src={photoUrl} alt="Telegram profile" className={`${cls} object-cover`} />;
  return <span className={`grid ${cls} place-items-center border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]`}><UserRound size={size === "md" ? 18 : 15} /></span>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile, loading, error } = useTelegramProfile();

  if (loading) {
    return <div className="mx-auto min-h-screen max-w-md px-3 pt-3"><div className="mxm-skeleton h-11 rounded-lg" /><div className="mxm-skeleton mt-3 h-40 rounded-lg" /><div className="mt-3 grid grid-cols-2 gap-2"><div className="mxm-skeleton aspect-square rounded-lg" /><div className="mxm-skeleton aspect-square rounded-lg" /></div></div>;
  }

  if (error || !profile) {
    return <main className="mx-auto flex min-h-screen max-w-md items-center px-4"><div className="w-full rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"><h1 className="text-base font-semibold">Telegram session required</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{error || "Authentication failed"}</p></div></main>;
  }

  return (
    <div className="mx-auto min-h-screen max-w-[1280px] lg:grid lg:grid-cols-[218px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-[var(--border-soft)] bg-[var(--bg)] p-3 lg:flex lg:flex-col">
        <Link href="/market" className="px-2 py-3 text-base font-semibold tracking-tight">MXM</Link>
        <nav className="mt-2 space-y-1">{nav.map((item) => { const active = pathname === item.href || pathname.startsWith(`${item.href}/`); const Icon = item.icon; return <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active ? "bg-[var(--panel-2)] text-white" : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-white"}`}><Icon size={17} />{item.label}</Link>; })}<Link href="/leaderboard" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${pathname.startsWith("/leaderboard") ? "bg-[var(--panel-2)] text-white" : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-white"}`}><Gem size={17} />Leaderboard</Link></nav>
        <Link href="/profile" className="mt-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3"><div className="flex items-center gap-2"><ProfileAvatar photoUrl={profile.photoUrl} /><div className="min-w-0"><p className="truncate text-xs font-medium">{profile.username ? `@${profile.username}` : profile.firstName}</p><p className="text-[10px] text-[var(--muted)]">{profile.tier}</p></div></div><div className="mt-3 border-t border-[var(--border-soft)] pt-2"><p className="text-[10px] text-[var(--muted)]">Net worth</p><p className="mt-0.5 text-sm font-semibold">{money(profile.netWorth)}</p></div></Link>
      </aside>

      <div className="min-w-0 pb-[70px] lg:pb-0">
        <header className="sticky top-0 z-40 border-b border-[var(--border-soft)] bg-[rgba(16,17,18,.97)] backdrop-blur-xl">
          <div className="flex h-[54px] items-center gap-2 px-3 md:px-4">
            <Link href="/profile" aria-label="Profile" className="shrink-0 lg:hidden"><ProfileAvatar photoUrl={profile.photoUrl} /></Link>
            <div className="hidden lg:block"><p className="text-xs font-semibold">MemeX Market</p><p className="text-[10px] text-[var(--muted)]">MXM trading network</p></div>
            <Link href="/vault" className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2.5 text-xs font-medium lg:ml-auto" title={profile.reservedBalance > 0 ? `${money(profile.availableBalance)} available · ${money(profile.reservedBalance)} reserved` : undefined}><Gem size={12} className="text-[var(--accent)]" fill="currentColor" />{money(profile.balance).replace("$", "")}</Link>
            <div className="ml-auto flex items-center gap-1.5 lg:ml-0"><Link href="/vault" aria-label="Wallet" className="header-action"><WalletCards size={16} /></Link><Link href="/hub" aria-label="Market feed" className="header-action"><Megaphone size={16} /></Link><Link href="/profile" aria-label="Menu" className="header-action"><Menu size={17} /></Link></div>
          </div>
        </header>
        <main className="px-3 py-3 md:px-4 md:py-4">{children}</main>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-[var(--border-soft)] bg-[rgba(19,20,21,.985)] pt-1 backdrop-blur-xl lg:hidden">
        {nav.map((item) => { const active = pathname === item.href || pathname.startsWith(`${item.href}/`); const Icon = item.icon; return <Link key={item.href} href={item.href} className={`relative flex min-w-0 flex-col items-center gap-0.5 px-1 pb-1 pt-1.5 text-[10px] ${active ? "text-white" : "text-[var(--muted)]"}`}>{active ? <span className="absolute -top-1 h-0.5 w-7 rounded-full bg-white" /> : null}<span className="grid h-7 w-9 place-items-center"><Icon size={18} strokeWidth={active ? 2.3 : 1.8} /></span><span className="truncate">{item.label}</span></Link>; })}
      </nav>
    </div>
  );
}
