"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, Bell, Boxes, Crown, Gem, ListChecks, PackageOpen, Plus, ReceiptText, Sparkles, Star, Store, Trophy } from "lucide-react";
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

function presenceSessionId() {
  const key = "mxm:presence-session:v1";
  try {
    const current = window.sessionStorage.getItem(key);
    if (current) return current;
    const next = globalThis.crypto?.randomUUID?.() || `mxm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    return `mxm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function AppShell({ children, modal }: { children: React.ReactNode; modal?: React.ReactNode }) {
  const pathname = usePathname();
  const { profile, inspectionMode, loading, appReady, error, retryAuth } = useTelegramProfile();
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [desktopToolsReady, setDesktopToolsReady] = useState(false);
  const title = currentTitle(pathname);
  const profileId = profile?.id;

  useEffect(() => {
    let cancelled = false;
    if (!profileId || inspectionMode) return;
    apiFetch<{ config: RuntimeConfig }>("/api/runtime-config", { cacheMs: 15_000 })
      .then((payload) => { if (!cancelled) setRuntimeConfig(payload.config); })
      .catch((cause) => console.error("runtime config", cause));
    return () => { cancelled = true; };
  }, [profileId, inspectionMode]);

  useEffect(() => {
    if (!profileId || inspectionMode) return;
    const sessionId = presenceSessionId();
    const sendPresence = () => {
      if (document.visibilityState === "hidden") return;
      void fetch("/api/analytics/presence", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, route: pathname }),
      }).catch(() => undefined);
    };
    sendPresence();
    const interval = window.setInterval(sendPresence, 120_000);
    const handleVisibility = () => { if (document.visibilityState === "visible") sendPresence(); };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [pathname, profileId, inspectionMode]);

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
    return <main className="mxm-auth-wall"><div className="mxm-auth-card"><div className="mxm-auth-brand">MXM <span>MARKET</span></div><div className="mxm-auth-icon"><Sparkles size={18}/></div><h1>Откройте в Telegram</h1><p>{error || "Безопасный вход работает внутри @MemeXMarketBot."}</p><button type="button" onClick={retryAuth} className="mxm-primary-action mt-5 w-full">Повторить</button></div></main>;
  }

  if (runtimeConfig?.maintenanceMode) {
    return <main className="mx-auto flex min-h-[var(--mxm-viewport-height)] max-w-md items-center px-5"><section className="w-full rounded-[20px] border border-[var(--border)] bg-[var(--panel)] p-5"><p className="text-[11px] font-black tracking-[-.06em]">MXM</p><h1 className="mt-4 text-base font-semibold">Технические работы</h1><p className="mt-2 text-xs leading-5 text-[var(--muted)]">{runtimeConfig.maintenanceMessage}</p><button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-[14px] bg-[var(--panel-3)] px-3 py-2 text-[11px] font-medium">Проверить снова</button></section></main>;
  }

  return (
    <div className="mxm-shell-frame mx-auto min-h-[var(--mxm-viewport-height)] max-w-[1440px] lg:grid lg:grid-cols-[180px_minmax(0,1fr)]">
      <aside className="mxm-desktop-sidebar sticky top-0 hidden h-screen px-3 py-5 lg:flex lg:flex-col">
        <Link href="/market" className="mxm-brand-lockup">
          <span className="mxm-brand-mark">MXM</span>
          <span className="mxm-brand-copy"><b>MEMEX MARKET</b></span>
        </Link>
        <p className="mxm-nav-eyebrow">Торговля</p>
        <nav className="space-y-1">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`mxm-side-link ${active ? "is-active" : ""}`}><Icon size={17} strokeWidth={active ? 2.2 : 1.8} /><span>{item.label}</span></Link>;
          })}
        </nav>
        <p className="mxm-nav-eyebrow mt-5">Инструменты</p>
        <nav className="space-y-1">
          <Link href="/store" aria-current={pathname.startsWith("/store") ? "page" : undefined} className={`mxm-side-link ${pathname.startsWith("/store") ? "is-active" : ""}`}><Gem size={17} />Магазин MXM</Link>
          <Link href="/season" aria-current={pathname.startsWith("/season") ? "page" : undefined} className={`mxm-side-link ${pathname.startsWith("/season") ? "is-active" : ""}`}><Crown size={17} />Боевой пропуск</Link>
          <Link href="/cases" aria-current={pathname.startsWith("/cases") ? "page" : undefined} className={`mxm-side-link ${pathname.startsWith("/cases") ? "is-active" : ""}`}><PackageOpen size={17} />Кейсы</Link>
          <Link href="/leaderboard" aria-current={pathname.startsWith("/leaderboard") ? "page" : undefined} className={`mxm-side-link ${pathname.startsWith("/leaderboard") ? "is-active" : ""}`}><Trophy size={17} />Рейтинг</Link>
          <Link href="/watchlist" aria-current={pathname.startsWith("/watchlist") ? "page" : undefined} className={`mxm-side-link ${pathname.startsWith("/watchlist") ? "is-active" : ""}`}><Star size={17} />Избранное</Link>
          <Link href="/notifications" aria-current={pathname.startsWith("/notifications") ? "page" : undefined} className={`mxm-side-link ${pathname.startsWith("/notifications") ? "is-active" : ""}`}><Bell size={17} />Уведомления</Link>
        </nav>

        <Link href="/create" className="mxm-sidebar-cta"><span><Plus size={15}/></span><div><b>Запустить мемкоин</b></div></Link>

        <Link href="/profile" className="mxm-sidebar-profile mt-auto">
          <div className="flex items-center gap-2.5"><ProfileAvatar photoUrl={profile.photoUrl} name={profile.firstName} equippedFrame={profile.equippedFrame} size="small" /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{profile.username ? `@${profile.username}` : profile.firstName}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{money(profile.netWorth)} · ур. {profile.level}</p></div><span className="text-[8px] text-[var(--muted-2)]">{profile.xp} опыта</span></div>
          <div className="mxm-profile-progress"><div style={{ width: `${Math.round(profile.levelProgress * 100)}%` }} /></div>
        </Link>
      </aside>

      <div className="mxm-shell-content min-w-0 lg:pb-0">
        <header className="mxm-topbar mxm-topbar-fixed safe-top z-40">
          <div className="mxm-topbar-inner flex h-[52px] items-center gap-2.5 px-3 md:px-5">
            <Link href="/profile" aria-label="Профиль" className="shrink-0 lg:hidden"><ProfileAvatar photoUrl={profile.photoUrl} name={profile.firstName} equippedFrame={profile.equippedFrame} size="small" /></Link>
            <div className="flex min-w-0 items-center gap-2 lg:hidden"><p className="truncate text-[11px] font-black tracking-[-.055em]">MXM</p><span className="h-3 w-px bg-white/[.08]" /><p className="truncate text-[9px] text-[var(--muted)]">{title}</p></div>
            <div className="hidden min-w-0 lg:block"><p className="mxm-topbar-eyebrow">MXM MARKET</p><p className="truncate text-[13px] font-semibold tracking-[-.02em]">{title}</p></div>
            <div className="ml-auto flex items-center gap-1.5">{inspectionMode ? <span className="mxm-inspector-badge">READ ONLY</span> : null}<Link href="/watchlist" aria-label="Избранное" className="mxm-top-plus"><Star size={13}/></Link><Link href="/notifications" aria-label="Уведомления" className="mxm-top-plus"><Bell size={13}/></Link><Link href="/vault" className="mxm-balance-pill" title={profile.reservedBalance > 0 ? `${money(profile.availableBalance)} доступно · ${money(profile.reservedBalance)} зарезервировано` : "Виртуальный торговый баланс TON"}><Gem size={12} fill="currentColor" />{money(profile.balance)}</Link><Link href="/store" aria-label="Пополнить MXM" className="mxm-top-plus"><Plus size={14}/></Link></div>
          </div>
        </header>
        <main id="mxm-main" className="mxm-page-enter min-h-0 px-3 py-3 md:px-5 md:py-4">{children}</main>
      </div>

      <nav className="mxm-bottom-nav safe-bottom fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 lg:hidden">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`mxm-bottom-link ${active ? "is-active" : ""}`}><span className="mxm-bottom-icon"><Icon size={17} strokeWidth={active ? 2.35 : 1.8} /></span><span className="truncate">{item.label}</span></Link>;
        })}
      </nav>

      {desktopToolsReady ? <DeferredCommandPalette /> : null}
      {process.env.NODE_ENV !== "production" && desktopToolsReady ? <DeferredPerfOverlay /> : null}
      {modal}
      <AppLaunchScreen ready={appReady} />
    </div>
  );
}
