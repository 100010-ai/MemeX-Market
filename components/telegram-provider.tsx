"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Profile } from "@/lib/types";
import { apiFetch, prefetchApi, setApiCacheNamespace } from "@/lib/api";
import { telegramCapabilitySnapshot, telegramSupports } from "@/lib/telegram-webapp";
import { getClientPerformanceProfile } from "@/lib/client-performance";

type TelegramContextValue = {
  profile: Profile | null;
  inspectionMode: boolean;
  loading: boolean;
  appReady: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
  retryAuth: () => void;
  patchProfile: (patch: Partial<Profile>) => void;
  haptic: (style?: "light" | "medium" | "heavy") => void;
};

type SessionProfilePayload = {
  profile: Profile;
  inspectionMode?: boolean;
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

async function existingSession(attempts = 3, expectedTelegramId?: number | null): Promise<SessionProfilePayload | null> {
  let lastError: SessionCheckError | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const url = expectedTelegramId ? `/api/me?expectedTelegramId=${encodeURIComponent(String(expectedTelegramId))}` : "/api/me";
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) return null;
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload?.code === "SESSION_ACCOUNT_MISMATCH") return null;
      if (response.ok && payload?.profile) return {
        profile: payload.profile as Profile,
        inspectionMode: payload.inspectionMode === true,
      };
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
  // Telegram's injected SDK exposes these methods even when the active
  // WebApp protocol is 6.0, but calling them then logs noisy unsupported API
  // warnings. Gate protocol-versioned methods explicitly instead of relying
  // on optional chaining alone.
  if (telegramSupports(webApp, "colors")) {
    webApp.setHeaderColor?.("#07090c");
    webApp.setBackgroundColor?.("#07090c");
  }
}

function warmCurrentRoute(pathname: string) {
  if (pathname === "/" || pathname.startsWith("/hub")) {
    void prefetchApi("/api/feed?limit=20", { cacheMs: 6_000 });
    return;
  }
  if (pathname.startsWith("/market")) {
    void prefetchApi("/api/market?scope=gifts&limit=24&t=0", { cacheMs: 12_000, timeoutMs: 18_000 });
    return;
  }
  if (pathname.startsWith("/orders")) void prefetchApi("/api/orders", { cacheMs: 8_000 });
  else if (pathname.startsWith("/vault") || pathname.startsWith("/portfolio")) void prefetchApi("/api/portfolio", { cacheMs: 8_000 });
  else if (pathname.startsWith("/tasks")) void prefetchApi("/api/tasks", { cacheMs: 8_000 });
}

export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isControl = pathname.startsWith("/control") || pathname.startsWith("/admin");
  const isPublic = pathname === "/about" || pathname === "/terms" || pathname === "/paysupport";
  const [profile, setProfile] = useState<Profile | null>(null);
  const [inspectionMode, setInspectionMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [appReady, setAppReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authNonce, setAuthNonce] = useState(0);
  const authInFlight = useRef(false);
  const authRun = useRef(0);

  const refreshProfile = useCallback(async () => {
    try {
      const activeTelegramId = telegramUserIdFromInitData(window.Telegram?.WebApp?.initData);
      if (activeTelegramId && profile && profile.telegramId !== activeTelegramId) {
        setApiCacheNamespace(`tg:${activeTelegramId}`);
        setProfile(null);
        setInspectionMode(false);
        setAppReady(false);
        setLoading(true);
        setAuthNonce((value) => value + 1);
        return;
      }
      const meUrl = activeTelegramId ? `/api/me?expectedTelegramId=${encodeURIComponent(String(activeTelegramId))}` : "/api/me";
      const result = await apiFetch<SessionProfilePayload>(meUrl, { cacheMs: 0, dedupe: false });
      setApiCacheNamespace(result.inspectionMode ? "inspector" : `tg:${result.profile.telegramId}`);
      setProfile(result.profile);
      setInspectionMode(result.inspectionMode === true);
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
    const webApp = window.Telegram?.WebApp;
    if (!telegramSupports(webApp, "haptics")) return;
    webApp?.HapticFeedback?.impactOccurred(style);
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
          setInspectionMode(false);
          setAppReady(false);
          setLoading(true);
        }
        let sessionPayload: SessionProfilePayload | null = null;
        let sessionError: unknown = null;

        if (immediateWebApp?.initData) {
          try { sessionPayload = await existingSession(3, currentTelegramId); }
          catch (cause) { sessionError = cause; }
        } else {
          const [webAppResult, sessionResult] = await Promise.allSettled([
            waitForInitData(1_800),
            existingSession(),
          ]);
          webApp = webAppResult.status === "fulfilled" ? webAppResult.value : null;
          currentTelegramId = telegramUserIdFromInitData(webApp?.initData);
          sessionPayload = sessionResult.status === "fulfilled" ? sessionResult.value : null;
          sessionError = sessionResult.status === "rejected" ? sessionResult.reason : null;

          // In the rare case Telegram injected initData after the session read,
          // validate the already loaded profile against the now-known account.
          if (sessionPayload && currentTelegramId && sessionPayload.profile.telegramId !== currentTelegramId) {
            forcedIdentitySwitch = true;
            setApiCacheNamespace(`tg:${currentTelegramId}`);
            setProfile(null);
            setInspectionMode(false);
            setAppReady(false);
            sessionPayload = null;
          }
        }

        if (sessionPayload && (!currentTelegramId || sessionPayload.profile.telegramId === currentTelegramId)) {
          setApiCacheNamespace(sessionPayload.inspectionMode ? "inspector" : `tg:${sessionPayload.profile.telegramId}`);
          warmCurrentRoute(pathname);
          if (!cancelled && run === authRun.current) {
            setProfile(sessionPayload.profile);
            setInspectionMode(sessionPayload.inspectionMode === true);
          }
          return;
        }

        // A different Telegram account is active in the WebApp than the one
        // stored in our cookie. Never render or prefetch with the old identity.
        if (sessionPayload && currentTelegramId && sessionPayload.profile.telegramId !== currentTelegramId) {
          forcedIdentitySwitch = true;
          setApiCacheNamespace(`tg:${currentTelegramId}`);
          setProfile(null);
          setInspectionMode(false);
          setAppReady(false);
        }

        if (!webApp?.initData) {
          if (sessionPayload) {
            setApiCacheNamespace(sessionPayload.inspectionMode ? "inspector" : `tg:${sessionPayload.profile.telegramId}`);
            if (!cancelled && run === authRun.current) {
              setProfile(sessionPayload.profile);
              setInspectionMode(sessionPayload.inspectionMode === true);
            }
            return;
          }
          const inspectRequested = new URLSearchParams(window.location.search).get("inspect") === "1";
          if (inspectRequested) {
            const inspected = await apiFetch<SessionProfilePayload>("/api/inspect/session", {
              method: "POST",
              body: JSON.stringify({}),
            });
            setApiCacheNamespace("inspector");
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete("inspect");
            window.history.replaceState(window.history.state, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
            if (!cancelled && run === authRun.current) {
              setProfile(inspected.profile);
              setInspectionMode(true);
            }
            return;
          }
          throw sessionError instanceof Error
            ? sessionError
            : new Error("Открой MXM через @MemeXMarketBot в Telegram.");
        }
        prepareWebApp();

        if (currentTelegramId) setApiCacheNamespace(`tg:${currentTelegramId}`);
        const result = await apiFetch<SessionProfilePayload>("/api/auth/telegram", {
          method: "POST",
          body: JSON.stringify({ initData: webApp.initData }),
        });
        setApiCacheNamespace(`tg:${result.profile.telegramId}`);
        setInspectionMode(false);
        warmCurrentRoute(pathname);
        if (!cancelled && run === authRun.current) setProfile(result.profile);
      } catch (cause) {
        if (!cancelled && run === authRun.current && (!profile || forcedIdentitySwitch)) {
          setApiCacheNamespace("anon");
          if (forcedIdentitySwitch) setProfile(null);
          if (forcedIdentitySwitch) setInspectionMode(false);
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
      setInspectionMode(false);
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
        setInspectionMode(false);
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
    const supportsActivationEvent = telegramSupports(webApp, "activationEvent");
    if (supportsActivationEvent) webApp?.onEvent?.("activated", checkIdentity);
    return () => {
      document.removeEventListener("visibilitychange", checkIdentity);
      window.removeEventListener("focus", checkIdentity);
      if (supportsActivationEvent) webApp?.offEvent?.("activated", checkIdentity);
    };
  }, [isControl, isPublic, profile?.telegramId]);

  useEffect(() => {
    const root = document.documentElement;
    const capabilities = telegramCapabilitySnapshot(window.Telegram?.WebApp);
    root.dataset.telegramVersion = capabilities.version;
    root.dataset.telegramSafeArea = capabilities.safeArea ? "1" : "0";
    root.dataset.telegramBackButton = capabilities.backButton ? "1" : "0";
    root.dataset.telegramInvoice = capabilities.invoice ? "1" : "0";
    return () => {
      delete root.dataset.telegramVersion;
      delete root.dataset.telegramSafeArea;
      delete root.dataset.telegramBackButton;
      delete root.dataset.telegramInvoice;
    };
  }, []);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    const root = document.documentElement;
    const supportsSafeArea = telegramSupports(webApp, "safeArea");
    const syncViewport = () => {
      const viewportHeight = Number(webApp?.viewportHeight || window.visualViewport?.height || window.innerHeight);
      const stableHeight = Number(webApp?.viewportStableHeight || viewportHeight);
      const safeTop = supportsSafeArea ? Math.max(Number(webApp?.safeAreaInset?.top || 0), Number(webApp?.contentSafeAreaInset?.top || 0)) : 0;
      const safeBottom = supportsSafeArea ? Math.max(Number(webApp?.safeAreaInset?.bottom || 0), Number(webApp?.contentSafeAreaInset?.bottom || 0)) : 0;
      const keyboardHeight = Math.max(0, stableHeight - viewportHeight);
      if (Number.isFinite(viewportHeight) && viewportHeight > 0) root.style.setProperty("--mxm-viewport-height", `${Math.round(viewportHeight)}px`);
      if (Number.isFinite(stableHeight) && stableHeight > 0) root.style.setProperty("--mxm-viewport-stable-height", `${Math.round(stableHeight)}px`);
      if (Number.isFinite(safeTop) && safeTop >= 0) root.style.setProperty("--mxm-safe-area-top", `${Math.round(safeTop)}px`);
      if (Number.isFinite(safeBottom) && safeBottom >= 0) root.style.setProperty("--mxm-safe-area-bottom", `${Math.round(safeBottom)}px`);
      if (Number.isFinite(keyboardHeight)) root.style.setProperty("--mxm-keyboard-height", `${Math.round(keyboardHeight)}px`);
      root.classList.toggle("mxm-keyboard-open", keyboardHeight > 120);
    };
    syncViewport();
    webApp?.onEvent?.("viewportChanged", syncViewport);
    const supportsSafeAreaEvents = supportsSafeArea;
    if (supportsSafeAreaEvents) {
      webApp?.onEvent?.("safeAreaChanged", syncViewport);
      webApp?.onEvent?.("contentSafeAreaChanged", syncViewport);
    }
    window.visualViewport?.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewport);
    return () => {
      webApp?.offEvent?.("viewportChanged", syncViewport);
      if (supportsSafeAreaEvents) {
        webApp?.offEvent?.("safeAreaChanged", syncViewport);
        webApp?.offEvent?.("contentSafeAreaChanged", syncViewport);
      }
      window.visualViewport?.removeEventListener("resize", syncViewport);
      window.removeEventListener("orientationchange", syncViewport);
      root.classList.remove("mxm-keyboard-open");
    };
  }, []);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!telegramSupports(webApp, "backButton")) return;
    const backButton = webApp?.BackButton;
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

    setAppReady(true);

    const performanceProfile = getClientPerformanceProfile();
    const constrainedDevice = performanceProfile.constrained;
    const root = document.documentElement;
    root.classList.toggle("mxm-device-constrained", constrainedDevice);
    return () => { root.classList.remove("mxm-device-constrained"); };
  }, [profileId, isControl, isPublic]);

  const value = useMemo(() => ({ profile, inspectionMode, loading, appReady, error, refreshProfile, retryAuth, patchProfile, haptic }), [profile, inspectionMode, loading, appReady, error, refreshProfile, retryAuth, patchProfile, haptic]);
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
        version?: string;
        isVersionAtLeast?: (version: string) => boolean;
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
