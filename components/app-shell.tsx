"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bell, Boxes, Gem, ListChecks, Plus, ReceiptText, Star, Store, Trophy, UserRound } from "lucide-react";
import { useTelegramProfile } from "@/components/telegram-provider";
import { money } from "@/lib/format";
import { PerfOverlay } from "@/components/dev/perf-overlay";

const nav = [
  { href: "/market", label: "Маркет", icon: Store },
  { href: "/orders", label: "Ордера", icon: ReceiptText },
  { href: "/hub", label: "Лента", icon: Activity },
  { href: "/tasks", label: "Задания", icon: ListChecks },
  { href: "/vault", label: "Портфель", icon: Boxes },
];

const routeTitles: Array<[string, string]> = [
  ["/market", "Маркет"],
  ["/orders", "Ордера"],
  ["/hub", "Лента"],
  ["/tasks", "Задания"],
  ["/vault", "Портфель"],
  ["/portfolio", "Портфель"],
  ["/leaderboard", "Рейтинг"],
  ["/profile", "Профиль"],
  ["/watchlist", "Избранное"],
  ["/notifications", "Уведомления"],
  ["/support", "Пополнить"],
  ["/referrals", "Рефералы"],
  ["/cart", "Корзина"],
  ["/create", "Создать коин"],
  ["/collections", "Коллекция"],
  ["/gifts", "Подарок"],
  ["/coin", "Мемкоин"],
];

function currentTitle(pathname: string) {
  return routeTitles.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] || "MX Market";
}

function ProfileAvatar({ photoUrl, size = "sm" }: { photoUrl: string | null; size?: "sm" | "md" }) {
  const cls = size === "md" ? "h-10 w-10 rounded-full" : "h-8 w-8 rounded-full";
  if (photoUrl) return <img src={photoUrl} alt="Профиль Telegram" className={`${cls} object-cover ring-1 ring-white/[.10]`} />;
  return <span className={`grid ${cls} place-items-center bg-white/[.045] text-[var(--muted)] ring-1 ring-white/[.06]`}><UserRound size={size === "md" ? 18 : 15} /></span>;
}

export function AppShell({ children, modal }: { children: React.ReactNode; modal?: React.ReactNode }) {
  const pathname = usePathname();
  const { profile, loading, error, retryAuth } = useTelegramProfile();
  const title = currentTitle(pathname);

  if (pathname.startsWith("/control") || pathname.startsWith("/admin") || pathname === "/about" || pathname === "/moderation" || pathname === "/reward-confirmations") return <>{children}</>;

  if (loading) {
    return <div className="mx-auto min-h-[100dvh] max-w-md px-3 pt-3"><div className="mxm-skeleton h-12 rounded-[18px]" /><div className="mxm-skeleton mt-3 h-40 rounded-[22px]" /><div className="mt-3 grid grid-cols-2 gap-2.5"><div className="mxm-skeleton aspect-square rounded-[20px]" /><div className="mxm-skeleton aspect-square rounded-[20px]" /></div></div>;
  }

  if (!profile) {
    return <main className="mx-auto flex min-h-[100dvh] max-w-md items-center px-5"><div className="w-full border-t border-white/[.14] py-6"><div className="mb-5 text-[13px] font-black tracking-[-.08em]">MXM</div><h1 className="text-lg font-semibold tracking-[-.025em]">Нужна сессия Telegram</h1><p className="mt-2 text-xs leading-5 text-[var(--muted)]">{error || "Не удалось авторизоваться"}</p><button type="button" onClick={retryAuth} className="mt-5 border-b border-white pb-1 text-xs font-semibold text-white">Повторить вход</button></div></main>;
  }

  return (
    <div className="mx-auto min-h-[100dvh] max-w-[1320px] lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-[var(--border-soft)] px-4 py-5 lg:flex lg:flex-col">
        <Link href="/market" className="flex items-baseline gap-2 px-1 py-1">
          <span className="text-[13px] font-black tracking-[-.08em]">MXM</span>
          <span className="text-[9px] text-[var(--muted)]">market</span>
        </Link>
        <nav className="mt-4 space-y-1">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} className={`mxm-side-link ${active ? "is-active" : ""}`}><Icon size={17} strokeWidth={active ? 2.2 : 1.8} /><span>{item.label}</span></Link>;
          })}
          <Link href="/leaderboard" className={`mxm-side-link ${pathname.startsWith("/leaderboard") ? "is-active" : ""}`}><Trophy size={17} />Рейтинг</Link>
          <Link href="/watchlist" className={`mxm-side-link ${pathname.startsWith("/watchlist") ? "is-active" : ""}`}><Star size={17} />Избранное</Link>
          <Link href="/notifications" className={`mxm-side-link ${pathname.startsWith("/notifications") ? "is-active" : ""}`}><Bell size={17} />Уведомления</Link>
        </nav>

        <Link href="/profile" className="mt-auto border-t border-[var(--border-soft)] px-1 pt-4">
          <div className="flex items-center gap-2.5"><ProfileAvatar photoUrl={profile.photoUrl} /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{profile.username ? `@${profile.username}` : profile.firstName}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{money(profile.netWorth)} · ур. {profile.level}</p></div><span className="text-[8px] text-[var(--muted-2)]">{profile.xp} XP</span></div>
          <div className="mt-3 h-px overflow-hidden bg-white/[.05]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(profile.levelProgress * 100)}%` }} /></div>
        </Link>
      </aside>

      <div className="min-w-0 pb-[calc(84px+env(safe-area-inset-bottom))] lg:pb-0">
        <header className="mxm-topbar sticky top-0 z-40">
          <div className="flex h-[54px] items-center gap-2.5 px-3 md:px-5">
            <Link href="/profile" aria-label="Профиль" className="shrink-0 lg:hidden"><ProfileAvatar photoUrl={profile.photoUrl} /></Link>
            <div className="min-w-0 lg:hidden"><p className="truncate text-[11px] font-black tracking-[-.055em]">MXM</p><p className="mt-0.5 truncate text-[9px] text-[var(--muted)]">{title}</p></div>
            <div className="hidden min-w-0 lg:block"><p className="truncate text-[12px] font-semibold tracking-[-.015em]">{title}</p></div>
            <div className="ml-auto flex items-center gap-1.5"><Link href="/watchlist" aria-label="Избранное" className="mxm-top-plus"><Star size={13}/></Link><Link href="/notifications" aria-label="Уведомления" className="mxm-top-plus"><Bell size={13}/></Link><Link href="/vault" className="mxm-balance-pill" title={profile.reservedBalance > 0 ? `${money(profile.availableBalance)} доступно · ${money(profile.reservedBalance)} зарезервировано` : undefined}><Gem size={12} fill="currentColor" />{money(profile.balance)}</Link><Link href="/support" aria-label="Пополнить Stars" className="mxm-top-plus"><Plus size={14}/></Link></div>
          </div>
        </header>
        <main key={pathname} className="mxm-page-enter min-h-0 px-3 py-4 md:px-5 md:py-5">{children}</main>
      </div>

      <nav className="mxm-bottom-nav safe-bottom fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 lg:hidden">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} className={`mxm-bottom-link ${active ? "is-active" : ""}`}><span className="mxm-bottom-icon"><Icon size={17} strokeWidth={active ? 2.35 : 1.8} /></span><span className="truncate">{item.label}</span></Link>;
        })}
      </nav>

      <PerfOverlay />
      {modal}
    </div>
  );
}
