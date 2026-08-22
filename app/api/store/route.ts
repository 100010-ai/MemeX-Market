import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizeStoreProduct } from "@/lib/store";
import { getRuntimeConfig } from "@/lib/runtime-config";

function schemaMissing(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (
    ["42P01", "42703", "42883", "PGRST202", "PGRST204"].includes(String(error.code || ""))
    || /store_products|monetization_snapshot_v200|schema cache|could not find the function|does not exist/i.test(error.message || "")
  ));
}

const emptySnapshot = {
  wallet: {
    mxmCoins: 0,
    energy: 100,
    maxEnergy: 100,
    premiumUntil: null,
    premiumActive: false,
    dailyBonusAvailable: false,
    vipTier: "Bronze",
    vipProgress: 0,
  },
  inventory: [] as Array<{ sku: string; quantity: number }>,
  entitlements: [] as Array<{ key: string; expiresAt: string | null }>,
  profileItems: [] as Array<{ key: string; type: string; title: string; equipped: boolean }>,
  mxmShop: [] as Array<{ sku: string; mxmPrice: number; title: string; rewardLabel: string; metadata: Record<string, unknown> }>,
  creatorCoins: [] as Array<{ id: string; name: string; symbol: string }>,
  caseOdds: {} as Record<string, Array<{ label: string; percent: number; rarity: string }>>,
  caseAvailability: {} as Record<string, number | null>,
  currentSeason: null as null | { id: string; title: string; startsAt: string; endsAt: string; daysLeft: number },
};

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
  if (cleanupResult.error) console.error("store reservation cleanup", cleanupResult.error);
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

  if (schemaMissing(productsResult.error) || schemaMissing(snapshotResult.error) || schemaMissing(caseLootResult.error) || schemaMissing(caseDefinitionsResult.error) || schemaMissing(seasonResult.error)) {
    console.error("store schema is not production-ready", productsResult.error || snapshotResult.error || caseLootResult.error || caseDefinitionsResult.error || seasonResult.error);
    return NextResponse.json({ error: "Схема MXM Store не соответствует production-миграциям" }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
  if (productsResult.error) {
    console.error("store products", productsResult.error);
    return NextResponse.json({ error: "Не удалось загрузить MXM Store" }, { status: 500 });
  }
  if (snapshotResult.error) {
    console.error("store snapshot", snapshotResult.error);
    return NextResponse.json({ error: "Не удалось загрузить статус экономики" }, { status: 500 });
  }
  if (caseLootResult.error) {
    console.error("store case odds", caseLootResult.error);
    return NextResponse.json({ error: "Не удалось загрузить вероятности кейсов" }, { status: 500 });
  }
  if (caseDefinitionsResult.error || seasonResult.error) {
    console.error("store availability", caseDefinitionsResult.error || seasonResult.error);
    return NextResponse.json({ error: "Не удалось загрузить доступность товаров" }, { status: 500 });
  }

  try {
    const snapshot = snapshotResult.data && typeof snapshotResult.data === "object" && !Array.isArray(snapshotResult.data)
      ? snapshotResult.data as Record<string, unknown>
      : {};
    const wallet = snapshot.wallet && typeof snapshot.wallet === "object" && !Array.isArray(snapshot.wallet)
      ? snapshot.wallet
      : emptySnapshot.wallet;
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
