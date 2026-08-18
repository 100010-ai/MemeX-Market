"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Boxes, CircleDollarSign, ListChecks, Plus, ReceiptText, Trophy } from "lucide-react";
import { useTelegramProfile } from "@/components/telegram-provider";
import { money } from "@/lib/format";
import { Verified } from "@/components/ui";

const nav = [
  { href: "/market", label: "Market", icon: BarChart3 },
  { href: "/orders", label: "Orders", icon: ReceiptText },
  { href: "/create", label: "Create", icon: Plus },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/vault", label: "Vault", icon: Boxes },
];

function ProfileAvatar({ photoUrl, name }: { photoUrl: string | null; name: string }) {
  if (photoUrl) return <img src={photoUrl} alt="Telegram avatar" className="h-8 w-8 rounded-lg object-cover" />;
  return <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--panel-3)] text-xs font-semibold">{name.slice(0, 1).toUpperCase()}</span>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile, loading, error } = useTelegramProfile();

  if (loading) return <div className="grid min-h-screen place-items-center bg-[var(--bg)] text-sm text-[var(--muted)]">Connecting to Telegram…</div>;
  if (error || !profile) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
        <div className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-[var(--accent)] text-black"><CircleDollarSign size={23} /></div>
          <h1 className="text-lg font-semibold">MemeX needs Telegram</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{error || "Authentication failed"}</p>
        </div>
      </main>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-[1320px] lg:grid lg:grid-cols-[208px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-[var(--border-soft)] bg-[var(--surface)] p-3 lg:flex lg:flex-col">
        <Link href="/market" className="flex items-center gap-2 px-2 py-3 text-base font-semibold">MEMEX <Verified /></Link>
        <nav className="mt-3 space-y-1">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active ? "bg-[var(--panel-2)] text-white" : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-white"}`}><Icon size={17} />{item.label}</Link>;
          })}
          <Link href="/leaderboard" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${pathname.startsWith("/leaderboard") ? "bg-[var(--panel-2)] text-white" : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-white"}`}><Trophy size={17} />Leaderboard</Link>
        </nav>
        <div className="mt-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
          <p className="text-[11px] text-[var(--muted)]">Virtual cash</p>
          <p className="mt-1 text-base font-semibold">{money(profile.balance)}</p>
          <p className="mt-2 text-[11px] text-[var(--muted)]">{profile.tier} · Net {money(profile.netWorth)}</p>
        </div>
      </aside>

      <div className="min-w-0 pb-20 lg:pb-0">
        <header className="sticky top-0 z-40 border-b border-[var(--border-soft)] bg-[rgba(16,17,18,.95)] backdrop-blur-xl">
          <div className="flex h-[62px] items-center justify-between gap-3 px-3 md:px-5">
            <Link href="/market" className="flex items-center gap-1.5 font-semibold lg:hidden">MEMEX <Verified /></Link>
            <div className="hidden lg:block">
              <p className="text-[11px] text-[var(--muted)]">Net worth</p>
              <p className="text-sm font-semibold">{money(profile.netWorth)}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5 text-xs"><span className="text-[var(--accent)]">◆</span> {money(profile.balance)}</div>
              <Link href="/leaderboard" aria-label="Leaderboard" className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:text-white"><Trophy size={16} /></Link>
              <Link href="/profile" className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 pr-2.5">
                <ProfileAvatar photoUrl={profile.photoUrl} name={profile.firstName} />
                <span className="hidden max-w-28 truncate text-xs sm:block">{profile.username ? `@${profile.username}` : profile.firstName}</span>
              </Link>
            </div>
          </div>
        </header>
        <main className="px-3 py-3 md:px-5 md:py-5">{children}</main>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-[var(--border-soft)] bg-[rgba(18,19,20,.98)] pt-1.5 backdrop-blur-xl lg:hidden">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={`flex min-w-0 flex-col items-center gap-0.5 px-1 py-1 text-[10px] ${active ? "text-white" : "text-[var(--muted)]"}`}>
              <span className={`grid h-8 w-9 place-items-center rounded-lg ${item.href === "/create" ? "bg-[var(--accent)] text-black" : active ? "bg-[var(--panel-2)]" : ""}`}><Icon size={18} /></span>
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
