"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Boxes, Dices, Gem, ListChecks, ReceiptText, Store, Trophy, UserRound } from "lucide-react";
import { useTelegramProfile } from "@/components/telegram-provider";
import { money } from "@/lib/format";

const nav = [
  { href: "/market", label: "Маркет", icon: Store },
  { href: "/orders", label: "Ордера", icon: ReceiptText },
  { href: "/hub", label: "Хаб", icon: Activity },
  { href: "/games", label: "Игры", icon: Dices },
  { href: "/tasks", label: "Задания", icon: ListChecks },
  { href: "/vault", label: "Портфель", icon: Boxes },
];

function ProfileAvatar({ photoUrl, size = "sm" }: { photoUrl: string | null; size?: "sm" | "md" }) {
  const cls = size === "md" ? "h-10 w-10 rounded-[18px]" : "h-8 w-8 rounded-[15px]";
  if (photoUrl) return <img src={photoUrl} alt="Профиль Telegram" className={`${cls} object-cover`} />;
  return <span className={`grid ${cls} place-items-center text-[var(--muted)]`}><UserRound size={size === "md" ? 18 : 15} /></span>;
}

export function AppShell({ children, modal }: { children: React.ReactNode; modal?: React.ReactNode }) {
  const pathname = usePathname();
  const { profile, loading, error, retryAuth } = useTelegramProfile();

  if (pathname.startsWith("/control")) {
    return <>{children}</>;
  }

  if (loading) {
    return <div className="mx-auto min-h-[100dvh] max-w-md px-3 pt-3"><div className="mxm-skeleton h-11 rounded-[20px]" /><div className="mxm-skeleton mt-3 h-40 rounded-[20px]" /><div className="mt-3 grid grid-cols-2 gap-2.5"><div className="mxm-skeleton aspect-square rounded-[20px]" /><div className="mxm-skeleton aspect-square rounded-[20px]" /></div></div>;
  }

  if (!profile) {
    return <main className="mx-auto flex min-h-[100dvh] max-w-md items-center px-4"><div className="w-full rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-5"><h1 className="text-base font-semibold">Нужна сессия Telegram</h1><p className="mt-2 text-xs leading-5 text-[var(--muted)]">{error || "Не удалось авторизоваться"}</p><button type="button" onClick={retryAuth} className="mt-4 border-b border-[var(--border)] pb-1 text-xs font-medium text-white">Повторить вход</button></div></main>;
  }

  return (
    <div className="mx-auto min-h-[100dvh] max-w-[1280px] lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-[var(--border-soft)] bg-[rgba(5,6,7,.98)] p-3 lg:flex lg:flex-col">
        <Link href="/market" className="px-2 py-3 text-base font-semibold tracking-[-.02em]">MXM</Link>
        <nav className="mt-2 space-y-1.5">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-xs transition ${active ? "bg-[var(--panel-2)] text-white" : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-white"}`}><Icon size={17} />{item.label}</Link>;
          })}
          <Link href="/leaderboard" className={`flex items-center gap-3 rounded-[18px] px-3 py-2.5 text-xs transition ${pathname.startsWith("/leaderboard") ? "bg-[var(--panel-2)] text-white" : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-white"}`}><Trophy size={17} />Рейтинг</Link>
        </nav>
        <Link href="/profile" className="mt-auto rounded-[20px] border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="flex items-center gap-2.5"><ProfileAvatar photoUrl={profile.photoUrl} /><div className="min-w-0"><p className="truncate text-xs font-medium">{profile.username ? `@${profile.username}` : profile.firstName}</p><p className="text-[10px] text-[var(--muted)]">Ур. {profile.level} · {profile.tier}</p></div></div>
          <div className="mt-3 border-t border-[var(--border-soft)] pt-2.5"><div className="flex items-end justify-between gap-2"><div><p className="text-[10px] text-[var(--muted)]">Капитал</p><p className="mt-0.5 text-sm font-semibold">{money(profile.netWorth)}</p></div><span className="text-[9px] text-[var(--muted)]">{profile.xp} XP</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round(profile.levelProgress * 100)}%` }} /></div></div>
        </Link>
      </aside>

      <div className="min-w-0 pb-[calc(72px+env(safe-area-inset-bottom))] lg:pb-0">
        <header className="sticky top-0 z-40 border-b border-[var(--border-soft)] bg-[rgba(5,6,7,.88)] backdrop-blur-2xl">
          <div className="flex h-[54px] items-center gap-2.5 px-3 md:px-4">
            <Link href="/profile" aria-label="Профиль" className="shrink-0 lg:hidden"><ProfileAvatar photoUrl={profile.photoUrl} /></Link>
            <div className="hidden lg:block"><p className="text-xs font-semibold">MemeX Market</p><p className="text-[10px] text-[var(--muted)]">Виртуальный рынок MXM</p></div>
            <Link href="/vault" className="ml-auto flex h-9 items-center gap-1.5 border-b border-[var(--border)] px-1 text-xs font-medium lg:ml-auto" title={profile.reservedBalance > 0 ? `${money(profile.availableBalance)} доступно · ${money(profile.reservedBalance)} зарезервировано` : undefined}><Gem size={12} className="text-[var(--accent)]" fill="currentColor" />{money(profile.balance)}</Link>
          </div>
        </header>
        <main key={pathname} className="mxm-page-enter min-h-0 px-2.5 py-3 md:px-4 md:py-4">{children}</main>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-50 grid grid-cols-6 border-t border-[var(--border-soft)] bg-[rgba(7,9,11,.96)] px-1 pt-1 backdrop-blur-2xl lg:hidden">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} className={`relative flex min-w-0 flex-col items-center gap-0.5 px-0.5 pb-1 pt-1 text-[8px] min-[390px]:text-[9px] transition ${active ? "text-white" : "text-[var(--muted)]"}`}><span className="grid h-8 w-10 place-items-center"><Icon size={17} strokeWidth={active ? 2.2 : 1.7} /></span><span className="max-w-full truncate">{item.label}</span></Link>;
        })}
      </nav>

      {modal}
    </div>
  );
}
