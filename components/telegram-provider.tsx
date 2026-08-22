"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Profile } from "@/lib/types";
import { apiFetch, prefetchApi, setApiCacheNamespace } from "@/lib/api";

type TelegramContextValue = {
  profile: Profile | null;
  loading: boolean;
  appReady: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
  retryAuth: () => void;
  patchProfile: (patch: Partial<Profile>) => void;
  haptic: (style?: "light" | "medium" | "heavy") => void;
};

const TelegramContext = createContext<TelegramContextValue | null>(null);

class SessionCheckError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "SessionCheckError";
    this.status = status;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function existingSession(attempts = 3, expectedTelegramId?: number | null): Promise<Profile | null> {
  let lastError: SessionCheckError | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const url = expectedTelegramId ? `/api/me?expectedTelegramId=${encodeURIComponent(String(expectedTelegramId))}` : "/api/me";
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) return null;
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload?.code === "SESSION_ACCOUNT_MISMATCH") return null;
      if (response.ok && payload?.profile) return payload.profile as Profile;
      const message = typeof payload?.error === "string" ? payload.error : "Не удалось проверить сессию";
      lastError = new SessionCheckError(message, response.status);
      // 4xx other than 401 is authoritative and should not be hammered.
      if (response.status >= 400 && response.status < 500) throw lastError;
    } catch (cause) {
      if (cause instanceof SessionCheckError && cause.status != null && cause.status >= 400 && cause.status < 500) throw cause;
      lastError = cause instanceof SessionCheckError
        ? cause
        : new SessionCheckError(cause instanceof Error ? cause.message : "Сеть временно недоступна", null);
    }
    if (attempt + 1 < attempts) await sleep(120 * (attempt + 1));
  }
  throw lastError || new SessionCheckError("Не удалось проверить сессию", null);
}

async function waitForInitData(timeoutMs = 3500) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const webApp = window.Telegram?.WebApp;
    if (webApp?.initData) return webApp;
    await sleep(50);
  }
  return window.Telegram?.WebApp ?? null;
}


function telegramUserIdFromInitData(initData: string | null | undefined) {
  if (!initData) return null;
  try {
    const rawUser = new URLSearchParams(initData).get("user");
    if (!rawUser) return null;
    const parsed = JSON.parse(rawUser) as { id?: unknown } | null;
    const id = Number(parsed?.id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function prepareWebApp() {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;
  webApp.ready();
  webApp.expand();
  webApp.setHeaderColor?.("#07090c");
  webApp.setBackgroundColor?.("#07090c");
}

function warmCurrentRoute(pathname: string) {
  if (pathname === "/" || pathname.startsWith("/market")) {
    void prefetchApi("/api/market?scope=gifts&limit=24&t=0", { cacheMs: 12_000, timeoutMs: 18_000 });
    return;
  }
  if (pathname.startsWith("/orders")) void prefetchApi("/api/orders", { cacheMs: 8_000 });
  else if (pathname.startsWith("/vault") || pathname.startsWith("/portfolio")) void prefetchApi("/api/portfolio", { cacheMs: 8_000 });
  else if (pathname.startsWith("/tasks")) void prefetchApi("/api/tasks", { cacheMs: 8_000 });
  else if (pathname.startsWith("/hub")) void prefetchApi("/api/feed?limit=20", { cacheMs: 6_000 });
}

export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isControl = pathname.startsWith("/control");
  const isPublic = pathname === "/about" || pathname === "/terms" || pathname === "/paysupport";
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [appReady, setAppReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authNonce, setAuthNonce] = useState(0);
  const authInFlight = useRef(false);
  const authRun = useRef(0);
  const appWarmRun = useRef(0);

  const refreshProfile = useCallback(async () => {
    try {
      const activeTelegramId = telegramUserIdFromInitData(window.Telegram?.WebApp?.initData);
      if (activeTelegramId && profile && profile.telegramId !== activeTelegramId) {
        setApiCacheNamespace(`tg:${activeTelegramId}`);
        setProfile(null);
        setAppReady(false);
        setLoading(true);
        setAuthNonce((value) => value + 1);
        return;
      }
      const meUrl = activeTelegramId ? `/api/me?expectedTelegramId=${encodeURIComponent(String(activeTelegramId))}` : "/api/me";
      const result = await apiFetch<{ profile: Profile }>(meUrl, { cacheMs: 0, dedupe: false });
      setApiCacheNamespace(`tg:${result.profile.telegramId}`);
      setProfile(result.profile);
      setError(null);
    } catch (cause) {
      // A transient profile refresh must never wipe an already authenticated UI.
      if (!profile) throw cause;
      console.error("profile refresh", cause);
    }
  }, [profile]);

  const retryAuth = useCallback(() => {
    if (authInFlight.current) return;
    setAuthNonce((value: number) => value + 1);
  }, []);

  const patchProfile = useCallback((patch: Partial<Profile>) => {
    setProfile((current: Profile | null) => current ? { ...current, ...patch } : current);
  }, []);

  const haptic = useCallback((style: "light" | "medium" | "heavy" = "light") => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = ++authRun.current;
    prepareWebApp();
    if (isControl || isPublic) {
      return () => { cancelled = true; };
    }

    async function authenticateOnce() {
      authInFlight.current = true;
      if (!profile) setLoading(true);
      setError(null);
      let forcedIdentitySwitch = false;
      try {
        // Telegram Desktop can reuse the same origin cookie/storage after the
        // user switches Telegram accounts. Resolve the current Telegram
        // identity and the existing signed session in parallel, then only
        // reuse the session when both identities match.
        const immediateWebApp = window.Telegram?.WebApp?.initData ? window.Telegram.WebApp : null;
        let webApp = immediateWebApp;
        let currentTelegramId = telegramUserIdFromInitData(immediateWebApp?.initData);
        if (currentTelegramId && profile && profile.telegramId !== currentTelegramId) {
          // Never leave the previous account visible while the new Telegram
          // identity is being authenticated.
          forcedIdentitySwitch = true;
          setApiCacheNamespace(`tg:${currentTelegramId}`);
          setProfile(null);
          setAppReady(false);
          setLoading(true);
        }
        let sessionProfile: Profile | null = null;
        let sessionError: unknown = null;

        if (immediateWebApp?.initData) {
          try { sessionProfile = await existingSession(3, currentTelegramId); }
          catch (cause) { sessionError = cause; }
        } else {
          const [webAppResult, sessionResult] = await Promise.allSettled([
            waitForInitData(1_800),
            existingSession(),
          ]);
          webApp = webAppResult.status === "fulfilled" ? webAppResult.value : null;
          currentTelegramId = telegramUserIdFromInitData(webApp?.initData);
          sessionProfile = sessionResult.status === "fulfilled" ? sessionResult.value : null;
          sessionError = sessionResult.status === "rejected" ? sessionResult.reason : null;

          // In the rare case Telegram injected initData after the session read,
          // validate the already loaded profile against the now-known account.
          if (sessionProfile && currentTelegramId && sessionProfile.telegramId !== currentTelegramId) {
            forcedIdentitySwitch = true;
            setApiCacheNamespace(`tg:${currentTelegramId}`);
            setProfile(null);
            setAppReady(false);
            sessionProfile = null;
          }
        }

        if (sessionProfile && (!currentTelegramId || sessionProfile.telegramId === currentTelegramId)) {
          setApiCacheNamespace(`tg:${sessionProfile.telegramId}`);
          warmCurrentRoute(pathname);
          if (!cancelled && run === authRun.current) setProfile(sessionProfile);
          return;
        }

        // A different Telegram account is active in the WebApp than the one
        // stored in our cookie. Never render or prefetch with the old identity.
        if (sessionProfile && currentTelegramId && sessionProfile.telegramId !== currentTelegramId) {
          forcedIdentitySwitch = true;
          setApiCacheNamespace(`tg:${currentTelegramId}`);
          setProfile(null);
          setAppReady(false);
        }

        if (!webApp?.initData) {
          if (sessionProfile) {
            setApiCacheNamespace(`tg:${sessionProfile.telegramId}`);
            if (!cancelled && run === authRun.current) setProfile(sessionProfile);
            return;
          }
          throw sessionError instanceof Error
            ? sessionError
            : new Error("Открой MXM через @MemeXMarketBot в Telegram.");
        }
        prepareWebApp();

        if (currentTelegramId) setApiCacheNamespace(`tg:${currentTelegramId}`);
        const result = await apiFetch<{ profile: Profile }>("/api/auth/telegram", {
          method: "POST",
          body: JSON.stringify({ initData: webApp.initData }),
        });
        setApiCacheNamespace(`tg:${result.profile.telegramId}`);
        warmCurrentRoute(pathname);
        if (!cancelled && run === authRun.current) setProfile(result.profile);
      } catch (cause) {
        if (!cancelled && run === authRun.current && (!profile || forcedIdentitySwitch)) {
          setApiCacheNamespace("anon");
          if (forcedIdentitySwitch) setProfile(null);
          setError(cause instanceof Error ? cause.message : "Не удалось войти через Telegram");
        }
      } finally {
        if (run === authRun.current) {
          authInFlight.current = false;
          if (!cancelled) setLoading(false);
        }
      }
    }
    void authenticateOnce();
    return () => { cancelled = true; };
    // profile is intentionally not a dependency: normal page navigation and
    // profile patches must never restart Telegram authentication.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControl, isPublic, authNonce]);


  useEffect(() => {
    if (isControl || isPublic) return;
    const onAuthInvalid = () => {
      const nextTelegramId = telegramUserIdFromInitData(window.Telegram?.WebApp?.initData);
      setApiCacheNamespace(nextTelegramId ? `tg:${nextTelegramId}` : "anon");
      setProfile(null);
      setAppReady(false);
      setLoading(true);
      setAuthNonce((value) => value + 1);
    };
    window.addEventListener("mxm:auth-invalid", onAuthInvalid);
    return () => window.removeEventListener("mxm:auth-invalid", onAuthInvalid);
  }, [isControl, isPublic]);

  useEffect(() => {
    if (isControl || isPublic) return;
    let lastTelegramId = telegramUserIdFromInitData(window.Telegram?.WebApp?.initData);
    const checkIdentity = () => {
      const nextTelegramId = telegramUserIdFromInitData(window.Telegram?.WebApp?.initData);
      if (!nextTelegramId) return;
      const profileMismatch = profile?.telegramId != null && profile.telegramId !== nextTelegramId;
      if (lastTelegramId != null && lastTelegramId !== nextTelegramId || profileMismatch) {
        lastTelegramId = nextTelegramId;
        setApiCacheNamespace(`tg:${nextTelegramId}`);
        setProfile(null);
        setAppReady(false);
        setLoading(true);
        setAuthNonce((value) => value + 1);
        return;
      }
      lastTelegramId = nextTelegramId;
    };
    const webApp = window.Telegram?.WebApp;
    document.addEventListener("visibilitychange", checkIdentity);
    window.addEventListener("focus", checkIdentity);
    webApp?.onEvent?.("activated", checkIdentity);
    return () => {
      document.removeEventListener("visibilitychange", checkIdentity);
      window.removeEventListener("focus", checkIdentity);
      webApp?.offEvent?.("activated", checkIdentity);
    };
  }, [isControl, isPublic, profile?.telegramId]);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    const root = document.documentElement;
    const syncViewport = () => {
      const viewportHeight = Number(webApp?.viewportHeight || window.visualViewport?.height || window.innerHeight);
      const stableHeight = Number(webApp?.viewportStableHeight || viewportHeight);
      const safeTop = Math.max(Number(webApp?.safeAreaInset?.top || 0), Number(webApp?.contentSafeAreaInset?.top || 0));
      const safeBottom = Math.max(Number(webApp?.safeAreaInset?.bottom || 0), Number(webApp?.contentSafeAreaInset?.bottom || 0));
      if (Number.isFinite(viewportHeight) && viewportHeight > 0) root.style.setProperty("--mxm-viewport-height", `${Math.round(viewportHeight)}px`);
      if (Number.isFinite(stableHeight) && stableHeight > 0) root.style.setProperty("--mxm-viewport-stable-height", `${Math.round(stableHeight)}px`);
      if (Number.isFinite(safeTop) && safeTop >= 0) root.style.setProperty("--mxm-safe-area-top", `${Math.round(safeTop)}px`);
      if (Number.isFinite(safeBottom) && safeBottom >= 0) root.style.setProperty("--mxm-safe-area-bottom", `${Math.round(safeBottom)}px`);
    };
    syncViewport();
    webApp?.onEvent?.("viewportChanged", syncViewport);
    webApp?.onEvent?.("safeAreaChanged", syncViewport);
    webApp?.onEvent?.("contentSafeAreaChanged", syncViewport);
    window.visualViewport?.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewport);
    return () => {
      webApp?.offEvent?.("viewportChanged", syncViewport);
      webApp?.offEvent?.("safeAreaChanged", syncViewport);
      webApp?.offEvent?.("contentSafeAreaChanged", syncViewport);
      window.visualViewport?.removeEventListener("resize", syncViewport);
      window.removeEventListener("orientationchange", syncViewport);
    };
  }, []);

  useEffect(() => {
    const backButton = window.Telegram?.WebApp?.BackButton;
    if (!backButton) return;
    const rootRoutes = new Set(["/", "/market", "/orders", "/hub", "/tasks", "/vault", "/profile"]);
    const onBack = () => {
      if (window.history.length > 1) window.history.back();
      else router.replace("/market");
    };
    if (rootRoutes.has(pathname) || pathname.startsWith("/control") || pathname.startsWith("/admin")) backButton.hide();
    else { backButton.show(); backButton.onClick(onBack); }
    return () => { backButton.offClick(onBack); };
  }, [pathname, router]);

  const profileId = profile?.id ?? null;
  useEffect(() => {
    if (profileId && !isControl && !isPublic) warmCurrentRoute(pathname);
  }, [profileId, isControl, isPublic, pathname]);

  useEffect(() => {
    if (isControl || isPublic) {
      setAppReady(true);
      return;
    }
    if (!profileId) {
      setAppReady(false);
      return;
    }

    const run = ++appWarmRun.current;
    let cancelled = false;
    const startedAt = performance.now();
    setAppReady(false);

    const primaryRoutes = ["/market", "/orders", "/hub", "/tasks", "/vault"];
    const secondaryRoutes = ["/leaderboard", "/watchlist", "/notifications", "/profile", "/profile/customize", "/store", "/cart", "/referrals", "/season", "/cases", "/collections", "/create", "/creator"];
    for (const href of primaryRoutes) router.prefetch(href);

    const criticalRequests = [
      prefetchApi("/api/market?scope=gifts&limit=24&t=0", { cacheMs: 30_000, timeoutMs: 14_000 }),
      prefetchApi("/api/market/collections?limit=40", { cacheMs: 30_000, timeoutMs: 14_000 }),
      prefetchApi("/api/feed?limit=20", { cacheMs: 20_000, timeoutMs: 12_000 }),
      prefetchApi("/api/orders", { cacheMs: 20_000, timeoutMs: 12_000 }),
      prefetchApi("/api/portfolio", { cacheMs: 20_000, timeoutMs: 14_000 }),
      prefetchApi("/api/tasks", { cacheMs: 20_000, timeoutMs: 12_000 }),
      prefetchApi("/api/leaderboard?board=overall", { cacheMs: 20_000, timeoutMs: 12_000 }),
      prefetchApi("/api/runtime-config", { cacheMs: 30_000, timeoutMs: 10_000 }),
    ];

    const preload = Promise.allSettled(criticalRequests);
    const timeout = sleep(3_200);
    void Promise.race([preload, timeout]).then(async () => {
      const elapsed = performance.now() - startedAt;
      if (elapsed < 780) await sleep(780 - elapsed);
      if (cancelled || run !== appWarmRun.current) return;
      setAppReady(true);

      const warmSecondary = () => {
        for (const href of secondaryRoutes) router.prefetch(href);
        void Promise.allSettled([
          prefetchApi("/api/leaderboard?board=overall&limit=8", { cacheMs: 20_000, timeoutMs: 12_000 }),
          prefetchApi("/api/watchlist", { cacheMs: 20_000, timeoutMs: 12_000 }),
          prefetchApi("/api/notifications", { cacheMs: 15_000, timeoutMs: 12_000 }),
          prefetchApi("/api/profile/meta", { cacheMs: 25_000, timeoutMs: 12_000 }),
          prefetchApi("/api/cart", { cacheMs: 20_000, timeoutMs: 12_000 }),
          prefetchApi("/api/referrals", { cacheMs: 20_000, timeoutMs: 12_000 }),
          prefetchApi("/api/store", { cacheMs: 20_000, timeoutMs: 12_000 }),
          prefetchApi("/api/season", { cacheMs: 20_000, timeoutMs: 12_000 }),
          prefetchApi("/api/cases", { cacheMs: 20_000, timeoutMs: 12_000 }),
          prefetchApi("/api/collections/progress", { cacheMs: 20_000, timeoutMs: 12_000 }),
          prefetchApi("/api/coins", { cacheMs: 15_000, timeoutMs: 12_000 }),
          prefetchApi("/api/creator", { cacheMs: 15_000, timeoutMs: 12_000 }),
          prefetchApi("/api/profile/customize", { cacheMs: 15_000, timeoutMs: 12_000 }),
          prefetchApi("/api/market?scope=coins&limit=72&t=0", { cacheMs: 25_000, timeoutMs: 14_000 }),
        ]);
      };
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(warmSecondary, { timeout: 1_200 });
      else window.setTimeout(warmSecondary, 180);
    });

    return () => { cancelled = true; };
  }, [profileId, isControl, isPublic, router]);

  const value = useMemo(() => ({ profile, loading, appReady, error, refreshProfile, retryAuth, patchProfile, haptic }), [profile, loading, appReady, error, refreshProfile, retryAuth, patchProfile, haptic]);
  return <TelegramContext.Provider value={value}>{children}</TelegramContext.Provider>;
}

export function useTelegramProfile() {
  const value = useContext(TelegramContext);
  if (!value) throw new Error("useTelegramProfile must be used inside TelegramProvider");
  return value;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready: () => void;
        expand: () => void;
        close?: () => void;
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        HapticFeedback?: { impactOccurred: (style: "light" | "medium" | "heavy") => void };
        viewportHeight?: number;
        viewportStableHeight?: number;
        safeAreaInset?: { top?: number; bottom?: number; left?: number; right?: number };
        contentSafeAreaInset?: { top?: number; bottom?: number; left?: number; right?: number };
        onEvent?: (event: "viewportChanged" | "safeAreaChanged" | "contentSafeAreaChanged" | "activated", callback: () => void) => void;
        offEvent?: (event: "viewportChanged" | "safeAreaChanged" | "contentSafeAreaChanged" | "activated", callback: () => void) => void;
        BackButton?: { show: () => void; hide: () => void; onClick: (callback: () => void) => void; offClick: (callback: () => void) => void };
        openInvoice?: (url: string, callback?: (status: "paid" | "cancelled" | "failed" | "pending") => void) => void;
        openTelegramLink?: (url: string) => void;
      };
    };
  }
}
