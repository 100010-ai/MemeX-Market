import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizeStoreProduct } from "@/lib/store";

export type StoreStaticCatalog = {
  products: Array<Record<string, unknown>>;
  loot: Array<Record<string, unknown>>;
};

let catalogCache: { expiresAt: number; value: StoreStaticCatalog } | null = null;
let catalogInFlight: Promise<StoreStaticCatalog> | null = null;

export async function getStoreStaticCatalog() {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.value;
  if (catalogInFlight) return catalogInFlight;
  catalogInFlight = (async () => {
    const supabase = getSupabaseAdmin();
    const [productsResult, caseLootResult] = await Promise.all([
      supabase.from("store_products").select("sku,category,title,description,stars_price,reward_label,badge,sort_order,metadata").eq("active", true).order("sort_order", { ascending: true }).limit(250),
      supabase.from("case_loot_definitions").select("case_sku,reward_label,weight,rarity").eq("active", true).limit(2_000),
    ]);
    const error = productsResult.error || caseLootResult.error;
    if (error) throw error;
    const value: StoreStaticCatalog = {
      products: (productsResult.data || []) as Array<Record<string, unknown>>,
      loot: (caseLootResult.data || []) as Array<Record<string, unknown>>,
    };
    catalogCache = { expiresAt: Date.now() + 20_000, value };
    return value;
  })();
  try { return await catalogInFlight; } finally { catalogInFlight = null; }
}

export function buildCaseOdds(lootRows: Array<Record<string, unknown>>) {
  const normalizedLoot = lootRows.flatMap((row) => {
    const caseSku = typeof row.case_sku === "string" ? row.case_sku.trim() : "";
    const label = typeof row.reward_label === "string" ? row.reward_label.trim() : "";
    const rarity = typeof row.rarity === "string" ? row.rarity.trim() : "common";
    const weight = Number(row.weight);
    if (!caseSku || !label || !Number.isFinite(weight) || weight <= 0) return [];
    return [{ caseSku, label, rarity, weight }];
  });
  const totals = new Map<string, number>();
  for (const row of normalizedLoot) totals.set(row.caseSku, (totals.get(row.caseSku) || 0) + row.weight);
  const odds: Record<string, Array<{ label: string; percent: number; rarity: string }>> = {};
  for (const row of normalizedLoot) {
    const total = totals.get(row.caseSku) || 1;
    (odds[row.caseSku] ||= []).push({ label: row.label, percent: Math.round((row.weight / total) * 10_000) / 100, rarity: row.rarity });
  }
  return odds;
}

export function normalizeCatalogProducts(rows: Array<Record<string, unknown>>, memecoinsEnabled: boolean) {
  return rows.flatMap((row) => {
    const product = normalizeStoreProduct(row);
    return product ? [product] : [];
  }).filter((product) => memecoinsEnabled || product.metadata.creatorTool !== "boost");
}

export async function loadStoreAccountState(supabase: SupabaseClient, profileId: string) {
  const [snapshotResult, seasonResult, caseDefinitionsResult] = await Promise.all([
    supabase.rpc("monetization_snapshot_v200", { p_profile_id: profileId }),
    supabase.rpc("season_snapshot_v200", { p_profile_id: profileId }),
    supabase.from("case_definitions").select("sku,remaining_supply").eq("active", true).limit(250),
  ]);
  const error = snapshotResult.error || seasonResult.error || caseDefinitionsResult.error;
  if (error) throw error;
  return {
    snapshot: snapshotResult.data && typeof snapshotResult.data === "object" && !Array.isArray(snapshotResult.data) ? snapshotResult.data as Record<string, unknown> : {},
    season: seasonResult.data && typeof seasonResult.data === "object" && !Array.isArray(seasonResult.data) ? seasonResult.data as Record<string, unknown> : {},
    availability: Object.fromEntries(((caseDefinitionsResult.data || []) as Array<Record<string, unknown>>)
      .map((row) => [String(row.sku || ""), row.remaining_supply == null ? null : Number(row.remaining_supply)])
      .filter(([sku]) => Boolean(sku))),
  };
}
