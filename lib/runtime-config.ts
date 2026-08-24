import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type RuntimeFeatureFlags = {
  gifts: boolean;
  memecoins: boolean;
  referrals: boolean;
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

function requireInt(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label}: допустимо целое число от ${min} до ${max}`);
  }
  return value;
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

type RuntimeConfigCache = { expiresAt: number; value: RuntimeConfig };

const RUNTIME_CONFIG_TTL_MS = 8_000;
let runtimeConfigCache: RuntimeConfigCache | null = null;
let runtimeConfigInFlight: Promise<RuntimeConfig> | null = null;

export function invalidateRuntimeConfigCache() {
  runtimeConfigCache = null;
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  const now = Date.now();
  if (runtimeConfigCache && runtimeConfigCache.expiresAt > now) return runtimeConfigCache.value;
  if (runtimeConfigInFlight) return runtimeConfigInFlight;

  runtimeConfigInFlight = (async () => {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("runtime_config_v056")
      .select("maintenance_mode,maintenance_message,feature_flags,remote_config,updated_at")
      .eq("singleton", true)
      .single();
    if (error) throw error;
    if (!data) throw new Error("Конфигурация приложения отсутствует");
    const value = normalizeRuntimeConfig(data as Record<string, unknown>);
    runtimeConfigCache = { expiresAt: Date.now() + RUNTIME_CONFIG_TTL_MS, value };
    return value;
  })();

  try {
    return await runtimeConfigInFlight;
  } finally {
    runtimeConfigInFlight = null;
  }
}

export function validateRuntimeConfigInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректная конфигурация");
  const input = value as Record<string, unknown>;
  if (typeof input.maintenanceMode !== "boolean") throw new Error("maintenanceMode должен быть boolean");
  const message = typeof input.maintenanceMessage === "string" ? input.maintenanceMessage.trim() : "";
  if (!message || message.length > 240) throw new Error("Сообщение техработ должно содержать от 1 до 240 символов");

  if (!input.featureFlags || typeof input.featureFlags !== "object" || Array.isArray(input.featureFlags)) {
    throw new Error("Некорректные Feature Flags");
  }
  const currentFlags = input.featureFlags as Record<string, unknown>;
  if (["gifts", "memecoins", "referrals", "stars"].some((key) => typeof currentFlags[key] !== "boolean")) {
    throw new Error("Все Feature Flags должны быть boolean");
  }

  if (!input.remoteConfig || typeof input.remoteConfig !== "object" || Array.isArray(input.remoteConfig)) {
    throw new Error("Некорректный Remote Config");
  }
  const currentRemote = input.remoteConfig as Record<string, unknown>;

  const flags: RuntimeFeatureFlags = {
    gifts: currentFlags.gifts as boolean,
    memecoins: currentFlags.memecoins as boolean,
    referrals: currentFlags.referrals as boolean,
    stars: currentFlags.stars as boolean,
  };
  const remoteConfig: RuntimeRemoteConfig = {
    maxPriceAlerts: requireInt(currentRemote.maxPriceAlerts, 1, 100, "maxPriceAlerts"),
    maxWatchlistItems: requireInt(currentRemote.maxWatchlistItems, 10, 500, "maxWatchlistItems"),
    marketPageSize: requireInt(currentRemote.marketPageSize, 12, 72, "marketPageSize"),
    coinOrderMaxOpen: requireInt(currentRemote.coinOrderMaxOpen, 1, 100, "coinOrderMaxOpen"),
    coinOrderMaxDays: requireInt(currentRemote.coinOrderMaxDays, 1, 30, "coinOrderMaxDays"),
  };
  return {
    maintenanceMode: input.maintenanceMode,
    maintenanceMessage: message,
    featureFlags: flags,
    remoteConfig,
  };
}
