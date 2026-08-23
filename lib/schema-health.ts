import type { SupabaseClient } from "@supabase/supabase-js";
import { REQUIRED_SCHEMA_VERSION } from "@/lib/app-version";

type SchemaProbe = {
  key: string;
  label: string;
  required: boolean;
  table: string;
  columns: string;
};

export type SchemaCapability = {
  key: string;
  label: string;
  required: boolean;
  ok: boolean;
  code: string | null;
};

export type SchemaHealth = {
  ready: boolean;
  schemaVersion: number;
  requiredSchemaVersion: number;
  missingRequired: string[];
  missingOptional: string[];
  capabilities: SchemaCapability[];
};

const PROBES: SchemaProbe[] = [
  { key: "memecoin_launch_seed", label: "Чистый запуск мемкоинов", required: true, table: "trades", columns: "id,is_launch_seed" },
  { key: "progression_rewards", label: "Уровни аккаунта", required: true, table: "account_level_rewards", columns: "level,reward_kind" },
  { key: "daily_streak", label: "Daily Streak", required: true, table: "daily_streak_state", columns: "profile_id,current_streak" },
  { key: "case_pity", label: "Гарантии кейсов", required: true, table: "case_definitions", columns: "sku,rare_pity,epic_pity,legendary_pity" },
  { key: "season_prestige", label: "Prestige Battle Pass", required: true, table: "season_prestige_claims", columns: "profile_id,prestige_level" },
  { key: "orders_fast_path", label: "Быстрый Realtime заявок", required: false, table: "gift_offers", columns: "id,seller_profile_id" },
];

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : null;
}

export async function inspectSchemaHealth(supabase: SupabaseClient): Promise<SchemaHealth> {
  const rpcResult = await supabase.rpc("mxm_schema_health_v0649");
  if (!rpcResult.error && rpcResult.data && typeof rpcResult.data === "object" && !Array.isArray(rpcResult.data)) {
    const raw = rpcResult.data as Record<string, unknown>;
    const rawCapabilities = Array.isArray(raw.capabilities) ? raw.capabilities : [];
    const capabilities: SchemaCapability[] = rawCapabilities.map((entry) => {
      const item = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
      return {
        key: String(item.key || "unknown"),
        label: String(item.label || item.key || "Schema capability"),
        required: item.required === true,
        ok: item.ok === true,
        code: null,
      };
    });
    const schemaVersion = Number(raw.schemaVersion || 0);
    const missingRequired = capabilities.filter((item) => item.required && !item.ok).map((item) => item.key);
    const missingOptional = capabilities.filter((item) => !item.required && !item.ok).map((item) => item.key);
    if (schemaVersion < REQUIRED_SCHEMA_VERSION) missingRequired.unshift("schema_version");
    return {
      ready: raw.ready === true && missingRequired.length === 0,
      schemaVersion,
      requiredSchemaVersion: Number(raw.requiredSchemaVersion || REQUIRED_SCHEMA_VERSION),
      missingRequired,
      missingOptional,
      capabilities,
    };
  }

  // Compatibility fallback for databases that have not applied the v0.64.9
  // diagnostic RPC yet. Each probe is a one-row metadata check, never a full scan.
  const versionResult = await supabase
    .from("economy_settings")
    .select("schema_version")
    .eq("singleton", true)
    .maybeSingle();

  const schemaVersion = Number(versionResult.data?.schema_version || 0);
  const capabilities = await Promise.all(PROBES.map(async (probe): Promise<SchemaCapability> => {
    const result = await supabase.from(probe.table).select(probe.columns).limit(1);
    return {
      key: probe.key,
      label: probe.label,
      required: probe.required,
      ok: !result.error,
      code: errorCode(result.error),
    };
  }));

  const versionReady = !versionResult.error && schemaVersion >= REQUIRED_SCHEMA_VERSION;
  const missingRequired = capabilities.filter((item) => item.required && !item.ok).map((item) => item.key);
  const missingOptional = capabilities.filter((item) => !item.required && !item.ok).map((item) => item.key);
  if (!versionReady) missingRequired.unshift("schema_version");

  return {
    ready: missingRequired.length === 0,
    schemaVersion,
    requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
    missingRequired,
    missingOptional,
    capabilities,
  };
}
