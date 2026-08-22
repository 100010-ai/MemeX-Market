import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizeStoreProduct } from "@/lib/store";
import { getRuntimeConfig } from "@/lib/runtime-config";



async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const runtimeConfig = await getRuntimeConfig().catch((error) => {
    console.error("store runtime config", error);
    return null;
  });
  if (!runtimeConfig) return NextResponse.json({ error: "Конфигурация магазина недоступна" }, { status: 503 });

  const supabase = getSupabaseAdmin();
  // Store reads are the lazy maintenance entry point even when every limited
  // case is reserved and no invoice button is available. This prevents an
  // abandoned pre-checkout from leaving stock or a unique entitlement wedged.
  const cleanupResult = await supabase
    .rpc("release_expired_star_authorizations_v200", { p_limit: 25 })
    .abortSignal(AbortSignal.timeout(1_500));
  if (cleanupResult.error) return apiFailure(cleanupResult.error, "Не удалось очистить просроченные резервы магазина");
  const [productsResult, snapshotResult, caseLootResult, caseDefinitionsResult, seasonResult] = await Promise.all([
    supabase
      .from("store_products")
      .select("sku,category,title,description,stars_price,reward_label,badge,sort_order,metadata")
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supabase.rpc("monetization_snapshot_v200", { p_profile_id: profile.id }),
    supabase
      .from("case_loot_definitions")
      .select("case_sku,reward_label,weight,rarity")
      .eq("active", true),
    supabase
      .from("case_definitions")
      .select("sku,remaining_supply")
      .eq("active", true),
    supabase.rpc("season_snapshot_v200", { p_profile_id: profile.id }),
  ]);

  const firstError = productsResult.error || snapshotResult.error || caseLootResult.error || caseDefinitionsResult.error || seasonResult.error;
  if (firstError) return apiFailure(firstError, "Не удалось загрузить MXM Store");

  try {
    const snapshot = snapshotResult.data && typeof snapshotResult.data === "object" && !Array.isArray(snapshotResult.data)
      ? snapshotResult.data as Record<string, unknown>
      : {};
    if (!snapshot.wallet || typeof snapshot.wallet !== "object" || Array.isArray(snapshot.wallet)) {
      return NextResponse.json({ error: "Wallet snapshot повреждён", code: "DATA_INTEGRITY" }, { status: 500 });
    }
    const wallet = snapshot.wallet;
    const lootRows = caseLootResult.data || [];
    const totals = new Map<string, number>();
    for (const row of lootRows) totals.set(row.case_sku, (totals.get(row.case_sku) || 0) + Number(row.weight || 0));
    const caseOdds: Record<string, Array<{ label: string; percent: number; rarity: string }>> = {};
    for (const row of lootRows) {
      const total = totals.get(row.case_sku) || 1;
      (caseOdds[row.case_sku] ||= []).push({
        label: row.reward_label,
        percent: Math.round((Number(row.weight || 0) / total) * 10_000) / 100,
        rarity: row.rarity,
      });
    }
    const products = (productsResult.data || [])
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
      caseAvailability: Object.fromEntries((caseDefinitionsResult.data || []).map((row) => [row.sku, row.remaining_supply == null ? null : Number(row.remaining_supply)])),
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
