import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type RuntimeFeatureFlags = {
  gifts: boolean;
  memecoins: boolean;
  referrals: boolean;
  rewardedAds: boolean;
  sponsoredTasks: boolean;
  stars: boolean;
};

export type RuntimeRemoteConfig = {
  maxPriceAlerts: number;
  maxWatchlistItems: number;
  marketPageSize: number;
  coinOrderMaxOpen: number;
  coinOrderMaxDays: number;
};

export type RuntimeConfig = {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  featureFlags: RuntimeFeatureFlags;
  remoteConfig: RuntimeRemoteConfig;
  updatedAt: string;
};

const defaultFlags: RuntimeFeatureFlags = {
  gifts: true,
  memecoins: true,
  referrals: true,
  rewardedAds: true,
  sponsoredTasks: false,
  stars: true,
};

const defaultRemote: RuntimeRemoteConfig = {
  maxPriceAlerts: 20,
  maxWatchlistItems: 100,
  marketPageSize: 24,
  coinOrderMaxOpen: 20,
  coinOrderMaxDays: 30,
};

function boolRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

export function normalizeRuntimeConfig(row: Record<string, unknown>): RuntimeConfig {
  const flags = boolRecord(row.feature_flags);
  const remote = boolRecord(row.remote_config);
  return {
    maintenanceMode: row.maintenance_mode === true,
    maintenanceMessage: typeof row.maintenance_message === "string" && row.maintenance_message.trim()
      ? row.maintenance_message.trim().slice(0, 240)
      : "Проводим технические работы. Попробуйте ещё раз чуть позже.",
    featureFlags: {
      gifts: typeof flags.gifts === "boolean" ? flags.gifts : defaultFlags.gifts,
      memecoins: typeof flags.memecoins === "boolean" ? flags.memecoins : defaultFlags.memecoins,
      referrals: typeof flags.referrals === "boolean" ? flags.referrals : defaultFlags.referrals,
      rewardedAds: typeof flags.rewardedAds === "boolean" ? flags.rewardedAds : defaultFlags.rewardedAds,
      sponsoredTasks: typeof flags.sponsoredTasks === "boolean" ? flags.sponsoredTasks : defaultFlags.sponsoredTasks,
      stars: typeof flags.stars === "boolean" ? flags.stars : defaultFlags.stars,
    },
    remoteConfig: {
      maxPriceAlerts: clampInt(remote.maxPriceAlerts, defaultRemote.maxPriceAlerts, 1, 100),
      maxWatchlistItems: clampInt(remote.maxWatchlistItems, defaultRemote.maxWatchlistItems, 10, 500),
      marketPageSize: clampInt(remote.marketPageSize, defaultRemote.marketPageSize, 12, 72),
      coinOrderMaxOpen: clampInt(remote.coinOrderMaxOpen, defaultRemote.coinOrderMaxOpen, 1, 100),
      coinOrderMaxDays: clampInt(remote.coinOrderMaxDays, defaultRemote.coinOrderMaxDays, 1, 30),
    },
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : new Date(0).toISOString(),
  };
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("runtime_config_v056")
    .select("maintenance_mode,maintenance_message,feature_flags,remote_config,updated_at")
    .eq("singleton", true)
    .single();
  if (error) throw error;
  if (!data) throw new Error("Runtime configuration is missing");
  return normalizeRuntimeConfig(data as Record<string, unknown>);
}

export function validateRuntimeConfigInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректная конфигурация");
  const input = value as Record<string, unknown>;
  const currentFlags = boolRecord(input.featureFlags);
  const currentRemote = boolRecord(input.remoteConfig);
  const message = typeof input.maintenanceMessage === "string" ? input.maintenanceMessage.trim() : "";
  if (!message || message.length > 240) throw new Error("Сообщение техработ должно содержать от 1 до 240 символов");
  const flags: RuntimeFeatureFlags = {
    gifts: currentFlags.gifts === true,
    memecoins: currentFlags.memecoins === true,
    referrals: currentFlags.referrals === true,
    rewardedAds: currentFlags.rewardedAds === true,
    sponsoredTasks: currentFlags.sponsoredTasks === true,
    stars: currentFlags.stars === true,
  };
  const remoteConfig: RuntimeRemoteConfig = {
    maxPriceAlerts: clampInt(currentRemote.maxPriceAlerts, NaN, 1, 100),
    maxWatchlistItems: clampInt(currentRemote.maxWatchlistItems, NaN, 10, 500),
    marketPageSize: clampInt(currentRemote.marketPageSize, NaN, 12, 72),
    coinOrderMaxOpen: clampInt(currentRemote.coinOrderMaxOpen, NaN, 1, 100),
    coinOrderMaxDays: clampInt(currentRemote.coinOrderMaxDays, NaN, 1, 30),
  };
  if (Object.values(remoteConfig).some((item) => !Number.isFinite(item))) throw new Error("Проверьте числовые лимиты Remote Config");
  return {
    maintenanceMode: input.maintenanceMode === true,
    maintenanceMessage: message,
    featureFlags: flags,
    remoteConfig,
  };
}
