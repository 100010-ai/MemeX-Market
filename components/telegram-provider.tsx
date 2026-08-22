"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Profile } from "@/lib/types";
import { apiFetch, prefetchApi } from "@/lib/api";

type TelegramContextValue = {
  profile: Profile | null;
  loading: boolean;
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

async function existingSession(attempts = 3): Promise<Profile | null> {
  let lastError: SessionCheckError | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch("/api/me", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) return null;
      const payload = await response.json().catch(() => ({}));
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
  const [error, setError] = useState<string | null>(null);
  const [authNonce, setAuthNonce] = useState(0);
  const authInFlight = useRef(false);
  const authRun = useRef(0);

  const refreshProfile = useCallback(async () => {
    try {
      const result = await apiFetch<{ profile: Profile }>("/api/me");
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
      try {
        let sessionError: unknown = null;
        try {
          const sessionProfile = await existingSession();
          if (sessionProfile) {
            warmCurrentRoute(pathname);
            if (!cancelled && run === authRun.current) setProfile(sessionProfile);
            return;
          }
        } catch (cause) {
          // Supabase/network can have a short transient failure. If Telegram
          // initData is present, use it to recover instead of showing a false
          // "Telegram session required" screen.
          sessionError = cause;
        }

        const webApp = await waitForInitData();
        if (!webApp?.initData) {
          if (profile) return;
          throw sessionError instanceof Error
            ? sessionError
            : new Error("Открой MXM через @MemeXMarketBot в Telegram.");
        }
        prepareWebApp();

        const result = await apiFetch<{ profile: Profile }>("/api/auth/telegram", {
          method: "POST",
          body: JSON.stringify({ initData: webApp.initData }),
        });
        warmCurrentRoute(pathname);
        if (!cancelled && run === authRun.current) setProfile(result.profile);
      } catch (cause) {
        if (!cancelled && run === authRun.current && !profile) setError(cause instanceof Error ? cause.message : "Не удалось войти через Telegram");
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

  const value = useMemo(() => ({ profile, loading, error, refreshProfile, retryAuth, patchProfile, haptic }), [profile, loading, error, refreshProfile, retryAuth, patchProfile, haptic]);
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
        onEvent?: (event: "viewportChanged" | "safeAreaChanged" | "contentSafeAreaChanged", callback: () => void) => void;
        offEvent?: (event: "viewportChanged" | "safeAreaChanged" | "contentSafeAreaChanged", callback: () => void) => void;
        BackButton?: { show: () => void; hide: () => void; onClick: (callback: () => void) => void; offClick: (callback: () => void) => void };
        openInvoice?: (url: string, callback?: (status: "paid" | "cancelled" | "failed" | "pending") => void) => void;
        openTelegramLink?: (url: string) => void;
      };
    };
  }
}
