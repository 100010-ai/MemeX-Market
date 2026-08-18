"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Profile } from "@/lib/types";
import { apiFetch } from "@/lib/api";

type TelegramContextValue = {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
  haptic: (style?: "light" | "medium" | "heavy") => void;
};

const TelegramContext = createContext<TelegramContextValue | null>(null);

export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    const result = await apiFetch<{ profile: Profile }>("/api/me");
    setProfile(result.profile);
  }, []);

  const haptic = useCallback((style: "light" | "medium" | "heavy" = "light") => {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function authenticate() {
      try {
        const webApp = window.Telegram?.WebApp;
        if (webApp?.initData) {
          webApp.ready();
          webApp.expand();
          webApp.setHeaderColor?.("#101112");
          webApp.setBackgroundColor?.("#101112");
          const result = await apiFetch<{ profile: Profile }>("/api/auth/telegram", {
            method: "POST",
            body: JSON.stringify({ initData: webApp.initData }),
          });
          if (!cancelled) setProfile(result.profile);
          return;
        }
        if (process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED === "true") {
          const result = await apiFetch<{ profile: Profile }>("/api/auth/dev", { method: "POST" });
          if (!cancelled) setProfile(result.profile);
          return;
        }
        throw new Error("Open MemeX from the Telegram bot. Local browser auth is disabled.");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Authentication failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    authenticate();
    return () => { cancelled = true; };
  }, []);

  const value = useMemo(() => ({ profile, loading, error, refreshProfile, haptic }), [profile, loading, error, refreshProfile, haptic]);
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
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        HapticFeedback?: { impactOccurred: (style: "light" | "medium" | "heavy") => void };
      };
    };
  }
}
