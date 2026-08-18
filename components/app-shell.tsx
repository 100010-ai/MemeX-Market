"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Gamepad2, ListChecks, MoreVertical, ReceiptText, Store, Trophy } from "lucide-react";
import { useTelegramProfile } from "@/components/telegram-provider";
import { money } from "@/lib/format";
import { Verified } from "@/components/ui";

const nav = [
  { href: "/market", label: "Market", icon: Store },
  { href: "/orders", label: "Orders", icon: ReceiptText },
  { href: "/hub", label: "Hub", icon: Gamepad2 },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/vault", label: "Vault", icon: Boxes },
];

function ProfileAvatar({ photoUrl, name, size = "sm" }: { photoUrl: string | null; name: string; size?: "sm" | "md" }) {
  const cls = size === "md" ? "h-10 w-10 rounded-xl" : "h-8 w-8 rounded-lg";
  if (photoUrl) return <img src={photoUrl} alt="Telegram avatar" className={`${cls} object-cover`} />;
  return <span className={`grid ${cls} place-items-center bg-[var(--panel-3)] text-xs font-semibold`}>{name.slice(0, 1).toUpperCase()}</span>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile, loading, error } = useTelegramProfile();

  if (loading) {
    return <div className="mx-auto min-h-screen max-w-md px-3 pt-5"><div className="mxm-skeleton h-11 rounded-xl" /><div className="mxm-skeleton mt-4 h-40 rounded-xl" /><div className="mt-3 grid grid-cols-2 gap-2"><div className="mxm-skeleton aspect-square rounded-xl" /><div className="mxm-skeleton aspect-square rounded-xl" /></div></div>;
  }
  if (error || !profile) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-5">
        <div className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <div className="mb-3 flex items-center gap-2 text-lg font-semibold">MXM <Verified /></div>
          <h1 className="text-base font-semibold">Telegram session required</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{error || "Authentication failed"}</p>
        </div>
      </main>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-[1280px] lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-[var(--border-soft)] bg-[#131415] p-3 lg:flex lg:flex-col">
        <Link href="/market" className="flex items-center gap-2 px-2 py-3 text-base font-semibold">MXM <Verified /></Link>
        <nav className="mt-3 space-y-1">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active ? "bg-[var(--panel-2)] text-white" : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-white"}`}><Icon size={17} />{item.label}</Link>;
          })}
          <Link href="/leaderboard" className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${pathname.startsWith("/leaderboard") ? "bg-[var(--panel-2)] text-white" : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-white"}`}><Trophy size={17} />Leaderboard</Link>
        </nav>
        <Link href="/profile" className="mt-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
          <div className="flex items-center gap-2"><ProfileAvatar photoUrl={profile.photoUrl} name={profile.firstName} /><div className="min-w-0"><p className="truncate text-xs font-medium">{profile.username ? `@${profile.username}` : profile.firstName}</p><p className="text-[10px] text-[var(--muted)]">{profile.tier}</p></div></div>
          <div className="mt-3 border-t border-[var(--border-soft)] pt-2"><p className="text-[10px] text-[var(--muted)]">Net worth</p><p className="mt-0.5 text-sm font-semibold">{money(profile.netWorth)}</p></div>
        </Link>
      </aside>

      <div className="min-w-0 pb-[76px] lg:pb-0">
        <header className="sticky top-0 z-40 border-b border-[var(--border-soft)] bg-[rgba(17,18,19,.96)] backdrop-blur-xl">
          <div className="flex h-[62px] items-center gap-3 px-3 md:px-5">
            <Link href="/market" className="flex items-center gap-1.5 font-semibold lg:hidden">MXM <Verified /></Link>
            <div className="hidden lg:block"><p className="text-[10px] text-[var(--muted)]">MemeX Market</p><p className="text-xs text-[#c6c9ce]">Virtual trading · Telegram native</p></div>
            <div className="ml-auto flex items-center gap-2">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5 text-xs"><span className="mr-1 text-[var(--accent)]">◆</span>{money(profile.balance).replace("$", "")}</div>
              <Link href="/leaderboard" aria-label="Leaderboard" className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]"><Trophy size={16} /></Link>
              <Link href="/profile" className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 pr-2"><ProfileAvatar photoUrl={profile.photoUrl} name={profile.firstName} /><MoreVertical size={14} className="text-[var(--muted)]" /></Link>
            </div>
          </div>
        </header>
        <main className="px-3 py-3 md:px-5 md:py-5">{children}</main>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-[var(--border-soft)] bg-[rgba(20,21,22,.98)] pt-1.5 backdrop-blur-xl lg:hidden">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={`flex min-w-0 flex-col items-center gap-0.5 px-1 py-1 text-[10px] ${active ? "text-white" : "text-[var(--muted)]"}`}>
              <span className={`grid h-8 w-9 place-items-center rounded-lg ${active ? "bg-[var(--panel-2)]" : ""}`}><Icon size={19} /></span>
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
