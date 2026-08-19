"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
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
  const isControl = pathname.startsWith("/control");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authNonce, setAuthNonce] = useState(0);
  const authInFlight = useRef(false);

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
    setAuthNonce((value) => value + 1);
  }, []);

  const patchProfile = useCallback((patch: Partial<Profile>) => {
    setProfile((current) => current ? { ...current, ...patch } : current);
  }, []);

  const haptic = useCallback((style: "light" | "medium" | "heavy" = "light") => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  }, []);

  useEffect(() => {
    let cancelled = false;
    prepareWebApp();
    if (isControl) {
      setLoading(false);
      setError(null);
      return () => { cancelled = true; };
    }

    async function authenticateOnce() {
      if (authInFlight.current) return;
      authInFlight.current = true;
      if (!profile) setLoading(true);
      setError(null);
      try {
        let sessionError: unknown = null;
        try {
          const sessionProfile = await existingSession();
          if (sessionProfile) {
            warmCurrentRoute(pathname);
            if (!cancelled) setProfile(sessionProfile);
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
        if (!cancelled) setProfile(result.profile);
      } catch (cause) {
        if (!cancelled && !profile) setError(cause instanceof Error ? cause.message : "Не удалось войти через Telegram");
      } finally {
        authInFlight.current = false;
        if (!cancelled) setLoading(false);
      }
    }

    void authenticateOnce();
    return () => { cancelled = true; };
    // profile is intentionally not a dependency: normal page navigation and
    // profile patches must never restart Telegram authentication.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControl, authNonce]);


  useEffect(() => {
    if (profile && !isControl) warmCurrentRoute(pathname);
  }, [profile?.id, isControl, pathname]);

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
      };
    };
  }
}
