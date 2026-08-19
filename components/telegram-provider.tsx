"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { Profile } from "@/lib/types";
import { apiFetch } from "@/lib/api";

type TelegramContextValue = {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
  patchProfile: (patch: Partial<Profile>) => void;
  haptic: (style?: "light" | "medium" | "heavy") => void;
};

const TelegramContext = createContext<TelegramContextValue | null>(null);

async function existingSession(): Promise<Profile | null> {
  const response = await fetch("/api/me", { cache: "no-store", credentials: "same-origin" });
  if (response.status === 401) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "Не удалось проверить сессию");
  return payload.profile as Profile;
}

async function waitForInitData(timeoutMs = 2500) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const webApp = window.Telegram?.WebApp;
    if (webApp?.initData) return webApp;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return window.Telegram?.WebApp ?? null;
}

export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isControl = pathname.startsWith("/control");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    const result = await apiFetch<{ profile: Profile }>("/api/me");
    setProfile(result.profile);
    setError(null);
  }, []);

  const patchProfile = useCallback((patch: Partial<Profile>) => {
    setProfile((current) => current ? { ...current, ...patch } : current);
  }, []);

  const haptic = useCallback((style: "light" | "medium" | "heavy" = "light") => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (isControl) {
      setLoading(false);
      setError(null);
      return () => { cancelled = true; };
    }

    async function authenticateOnce() {
      setLoading(true);
      setError(null);
      try {
        // A valid signed cookie is authoritative. Navigation inside the Mini App
        // must not re-run Telegram auth and consume login rate-limit entries.
        const sessionProfile = await existingSession();
        if (sessionProfile) {
          if (!cancelled) setProfile(sessionProfile);
          return;
        }

        const webApp = await waitForInitData();
        if (!webApp?.initData) throw new Error("Открой MXM через @MemeXMarketBot в Telegram.");
        webApp.ready();
        webApp.expand();
        webApp.setHeaderColor?.("#050607");
        webApp.setBackgroundColor?.("#050607");

        const result = await apiFetch<{ profile: Profile }>("/api/auth/telegram", {
          method: "POST",
          body: JSON.stringify({ initData: webApp.initData }),
        });
        if (!cancelled) setProfile(result.profile);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось войти через Telegram");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void authenticateOnce();
    return () => { cancelled = true; };
  }, [isControl]);

  const value = useMemo(() => ({ profile, loading, error, refreshProfile, patchProfile, haptic }), [profile, loading, error, refreshProfile, patchProfile, haptic]);
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
