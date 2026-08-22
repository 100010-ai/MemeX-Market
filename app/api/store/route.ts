import { apiFailure, withApiErrors } from "@/lib/api-route";
import { after, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizeStoreProduct } from "@/lib/store";
import { getRuntimeConfig } from "@/lib/runtime-config";

type StoreStaticCatalog = {
  products: Array<Record<string, unknown>>;
  loot: Array<Record<string, unknown>>;
  cases: Array<Record<string, unknown>>;
};
let storeCatalogCache: { expiresAt: number; value: StoreStaticCatalog } | null = null;
let storeCatalogInFlight: Promise<StoreStaticCatalog> | null = null;

async function getStoreStaticCatalog() {
  if (storeCatalogCache && storeCatalogCache.expiresAt > Date.now()) return storeCatalogCache.value;
  if (storeCatalogInFlight) return storeCatalogInFlight;
  storeCatalogInFlight = (async () => {
    const supabase = getSupabaseAdmin();
    const [productsResult, caseLootResult, caseDefinitionsResult] = await Promise.all([
      supabase.from("store_products").select("sku,category,title,description,stars_price,reward_label,badge,sort_order,metadata").eq("active", true).order("sort_order", { ascending: true }).limit(250),
      supabase.from("case_loot_definitions").select("case_sku,reward_label,weight,rarity").eq("active", true).limit(2_000),
      supabase.from("case_definitions").select("sku,remaining_supply").eq("active", true).limit(250),
    ]);
    const error = productsResult.error || caseLootResult.error || caseDefinitionsResult.error;
    if (error) throw error;
    const value: StoreStaticCatalog = {
      products: (productsResult.data || []) as Array<Record<string, unknown>>,
      loot: (caseLootResult.data || []) as Array<Record<string, unknown>>,
      cases: (caseDefinitionsResult.data || []) as Array<Record<string, unknown>>,
    };
    storeCatalogCache = { expiresAt: Date.now() + 20_000, value };
    return value;
  })();
  try { return await storeCatalogInFlight; } finally { storeCatalogInFlight = null; }
}


async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const runtimeConfig = await getRuntimeConfig().catch((error) => {
    console.error("store runtime config", error);
    return null;
  });
  if (!runtimeConfig) return NextResponse.json({ error: "Конфигурация магазина недоступна" }, { status: 503 });

  const supabase = getSupabaseAdmin();
  // Expired reservation cleanup is maintenance, not part of the user's read.
  // Running it after the response removes up to 1.5s from first store paint.
  after(async () => {
    try {
      const cleanupResult = await getSupabaseAdmin()
        .rpc("release_expired_star_authorizations_v200", { p_limit: 25 })
        .abortSignal(AbortSignal.timeout(1_500));
      if (cleanupResult.error) console.error("store reservation cleanup", cleanupResult.error);
    } catch (cleanupError) {
      console.error("store reservation cleanup", cleanupError);
    }
  });
  let catalog: StoreStaticCatalog;
  const [catalogResult, snapshotResult, seasonResult] = await Promise.all([
    getStoreStaticCatalog().then((value) => ({ value, error: null as unknown })).catch((error: unknown) => ({ value: null, error })),
    supabase.rpc("monetization_snapshot_v200", { p_profile_id: profile.id }),
    supabase.rpc("season_snapshot_v200", { p_profile_id: profile.id }),
  ]);
  const firstError = catalogResult.error || snapshotResult.error || seasonResult.error;
  if (firstError || !catalogResult.value) return apiFailure(firstError || new Error("Каталог магазина недоступен"), "Не удалось загрузить магазин MXM");
  catalog = catalogResult.value;

  try {
    const snapshot = snapshotResult.data && typeof snapshotResult.data === "object" && !Array.isArray(snapshotResult.data)
      ? snapshotResult.data as Record<string, unknown>
      : {};
    if (!snapshot.wallet || typeof snapshot.wallet !== "object" || Array.isArray(snapshot.wallet)) {
      return NextResponse.json({ error: "Данные кошелька повреждены", code: "DATA_INTEGRITY" }, { status: 500 });
    }
    const wallet = snapshot.wallet;
    const lootRows = catalog.loot;
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
    const caseOdds: Record<string, Array<{ label: string; percent: number; rarity: string }>> = {};
    for (const row of normalizedLoot) {
      const total = totals.get(row.caseSku) || 1;
      (caseOdds[row.caseSku] ||= []).push({
        label: row.label,
        percent: Math.round((row.weight / total) * 10_000) / 100,
        rarity: row.rarity,
      });
    }
    const products = catalog.products
      .flatMap((row) => {
        const product = normalizeStoreProduct(row as Record<string, unknown>);
        return product ? [product] : [];
      })
      .filter((product) => runtimeConfig.featureFlags.memecoins || product.metadata.creatorTool !== "boost");
    return NextResponse.json({
      products,
      wallet,
      inventory: Array.isArray(snapshot.inventory) ? snapshot.inventory : [],
      entitlements: Array.isArray(snapshot.entitlements) ? snapshot.entitlements : [],
      profileItems: Array.isArray(snapshot.profileItems) ? snapshot.profileItems : [],
      mxmShop: Array.isArray(snapshot.mxmShop) ? snapshot.mxmShop : [],
      creatorCoins: Array.isArray(snapshot.creatorCoins) ? snapshot.creatorCoins : [],
      caseOdds,
      caseAvailability: Object.fromEntries(catalog.cases.map((row) => [String(row.sku || ""), row.remaining_supply == null ? null : Number(row.remaining_supply)]).filter(([sku]) => Boolean(sku))),
      currentSeason: seasonResult.data && typeof seasonResult.data === "object" && !Array.isArray(seasonResult.data)
        ? ((seasonResult.data as Record<string, unknown>).season || null)
        : null,
      starsEnabled: runtimeConfig.featureFlags.stars,
      migrationReady: true,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("store payload", error);
    return NextResponse.json({ error: "Каталог магазина повреждён" }, { status: 500 });
  }
}
export const GET = withApiErrors("app/api/store/route.ts:GET", GETHandler);
