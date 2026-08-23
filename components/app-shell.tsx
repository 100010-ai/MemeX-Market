"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, Bell, Boxes, Gem, ListChecks, Plus, ReceiptText, Star, Store, Trophy } from "lucide-react";
import { useTelegramProfile } from "@/components/telegram-provider";
import { money } from "@/lib/format";
import { apiFetch } from "@/lib/api";
import type { RuntimeConfig } from "@/lib/runtime-config";
import { AppLaunchScreen } from "@/components/app-launch-screen";
import { ProfileAvatar } from "@/components/profile-avatar";


const DeferredCommandPalette = dynamic(() => import("@/components/command-palette").then((module) => module.CommandPalette), { ssr: false });
const DeferredPerfOverlay = dynamic(() => import("@/components/dev/perf-overlay").then((module) => module.PerfOverlay), { ssr: false });

const nav = [
  { href: "/market", label: "Рынок", icon: Store },
  { href: "/orders", label: "Заявки", icon: ReceiptText },
  { href: "/hub", label: "Главная", icon: Activity },
  { href: "/tasks", label: "Задания", icon: ListChecks },
  { href: "/vault", label: "Портфель", icon: Boxes },
];

const routeTitles: Array<[string, string]> = [
  ["/market", "Рынок"],
  ["/orders", "Заявки"],
  ["/hub", "Обзор"],
  ["/tasks", "Задания"],
  ["/vault", "Портфель"],
  ["/portfolio", "Портфель"],
  ["/leaderboard", "Рейтинг"],
  ["/profile", "Профиль"],
  ["/progression", "Прогресс"],
  ["/watchlist", "Избранное"],
  ["/notifications", "Уведомления"],
  ["/store", "Магазин MXM"],
  ["/season", "Боевой пропуск"],
  ["/cases", "Кейсы MXM"],
  ["/creator", "Инструменты автора"],
  ["/support", "Магазин MXM"],
  ["/referrals", "Рефералы"],
  ["/cart", "Корзина"],
  ["/create", "Создать мемкоин"],
  ["/collections", "Коллекция"],
  ["/gifts", "Подарок"],
  ["/coin", "Мемкоин"],
];

function currentTitle(pathname: string) {
  return routeTitles.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] || "Рынок MXM";
}

export function AppShell({ children, modal }: { children: React.ReactNode; modal?: React.ReactNode }) {
  const pathname = usePathname();
  const { profile, loading, appReady, error, retryAuth } = useTelegramProfile();
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [desktopToolsReady, setDesktopToolsReady] = useState(false);
  const title = currentTitle(pathname);
  const profileId = profile?.id;

  useEffect(() => {
    let cancelled = false;
    if (!profileId) return;
    apiFetch<{ config: RuntimeConfig }>("/api/runtime-config", { cacheMs: 15_000 })
      .then((payload) => { if (!cancelled) setRuntimeConfig(payload.config); })
      .catch((cause) => console.error("runtime config", cause));
    return () => { cancelled = true; };
  }, [profileId]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia("(min-width: 768px) and (pointer: fine)").matches) return;
    let cancelled = false;
    let timeout = 0;
    let idleId: number | null = null;
    const enable = () => { if (!cancelled) setDesktopToolsReady(true); };
    const idle = window.requestIdleCallback;
    if (typeof idle === "function") idleId = idle(enable, { timeout: 1_500 });
    else timeout = window.setTimeout(enable, 900);
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
      if (idleId != null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleId);
    };
  }, []);

  if (pathname.startsWith("/control") || pathname.startsWith("/admin") || pathname === "/about" || pathname === "/terms" || pathname === "/paysupport") return <>{children}</>;

  if (loading) {
    return <AppLaunchScreen ready={false} />;
  }

  if (!profile) {
    return <main className="mx-auto flex min-h-[100dvh] max-w-md items-center px-5"><div className="w-full border-t border-white/[.14] py-6"><div className="mb-5 text-[13px] font-black tracking-[-.08em]">MXM</div><h1 className="text-lg font-semibold tracking-[-.025em]">Нужна сессия Telegram</h1><p className="mt-2 text-xs leading-5 text-[var(--muted)]">{error || "Не удалось авторизоваться"}</p><button type="button" onClick={retryAuth} className="mt-5 border-b border-white pb-1 text-xs font-semibold text-white">Повторить вход</button></div></main>;
  }

  if (runtimeConfig?.maintenanceMode) {
    return <main className="mx-auto flex min-h-[var(--mxm-viewport-height)] max-w-md items-center px-5"><section className="w-full rounded-[20px] border border-[var(--border)] bg-[var(--panel)] p-5"><p className="text-[11px] font-black tracking-[-.06em]">MXM</p><h1 className="mt-4 text-base font-semibold">Технические работы</h1><p className="mt-2 text-xs leading-5 text-[var(--muted)]">{runtimeConfig.maintenanceMessage}</p><button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-[14px] bg-[var(--panel-3)] px-3 py-2 text-[11px] font-medium">Проверить снова</button></section></main>;
  }

  return (
    <div className="mx-auto min-h-[var(--mxm-viewport-height)] max-w-[1320px] lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-[var(--border-soft)] px-4 py-5 lg:flex lg:flex-col">
        <Link href="/market" className="flex items-baseline gap-2 px-1 py-1">
          <span className="text-[13px] font-black tracking-[-.08em]">MXM</span>
          <span className="text-[9px] text-[var(--muted)]">рынок</span>
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
          <div className="flex items-center gap-2.5"><ProfileAvatar photoUrl={profile.photoUrl} name={profile.firstName} equippedFrame={profile.equippedFrame} size="small" /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{profile.username ? `@${profile.username}` : profile.firstName}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{money(profile.netWorth)} · ур. {profile.level}</p></div><span className="text-[8px] text-[var(--muted-2)]">{profile.xp} опыта</span></div>
          <div className="mt-3 h-px overflow-hidden bg-white/[.05]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(profile.levelProgress * 100)}%` }} /></div>
        </Link>
      </aside>

      <div className="mxm-shell-content min-w-0 lg:pb-0">
        <header className="mxm-topbar mxm-topbar-fixed safe-top z-40">
          <div className="flex h-[54px] items-center gap-2.5 px-3 md:px-5">
            <Link href="/profile" aria-label="Профиль" className="shrink-0 lg:hidden"><ProfileAvatar photoUrl={profile.photoUrl} name={profile.firstName} equippedFrame={profile.equippedFrame} size="small" /></Link>
            <div className="min-w-0 lg:hidden"><p className="truncate text-[11px] font-black tracking-[-.055em]">MXM</p><p className="mt-0.5 truncate text-[9px] text-[var(--muted)]">{title}</p></div>
            <div className="hidden min-w-0 lg:block"><p className="truncate text-[12px] font-semibold tracking-[-.015em]">{title}</p></div>
            <div className="ml-auto flex items-center gap-1.5"><Link href="/watchlist" aria-label="Избранное" className="mxm-top-plus"><Star size={13}/></Link><Link href="/notifications" aria-label="Уведомления" className="mxm-top-plus"><Bell size={13}/></Link><Link href="/vault" className="mxm-balance-pill" title={profile.reservedBalance > 0 ? `${money(profile.availableBalance)} доступно · ${money(profile.reservedBalance)} зарезервировано` : undefined}><Gem size={12} fill="currentColor" />{money(profile.balance)}</Link><Link href="/store" aria-label="Магазин MXM" className="mxm-top-plus"><Plus size={14}/></Link></div>
          </div>
        </header>
        <main id="mxm-main" className="mxm-page-enter min-h-0 px-3 py-3 md:px-5 md:py-4">{children}</main>
      </div>

      <nav className="mxm-bottom-nav safe-bottom fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 lg:hidden">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} className={`mxm-bottom-link ${active ? "is-active" : ""}`}><span className="mxm-bottom-icon"><Icon size={17} strokeWidth={active ? 2.35 : 1.8} /></span><span className="truncate">{item.label}</span></Link>;
        })}
      </nav>

      {desktopToolsReady ? <DeferredCommandPalette /> : null}
      {process.env.NODE_ENV !== "production" && desktopToolsReady ? <DeferredPerfOverlay /> : null}
      {modal}
      <AppLaunchScreen ready={appReady} />
    </div>
  );
}
