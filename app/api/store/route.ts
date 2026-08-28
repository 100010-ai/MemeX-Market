import { apiFailure, withApiErrors } from "@/lib/api-route";
import { after, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { buildCaseOdds, getStoreStaticCatalog, loadStoreAccountState, normalizeCatalogProducts } from "@/lib/store-data";

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const runtimeConfig = await getRuntimeConfig().catch((error) => {
    console.error("store runtime config", error);
    return null;
  });
  if (!runtimeConfig) return NextResponse.json({ error: "Конфигурация магазина недоступна" }, { status: 503 });

  after(async () => {
    try {
      const cleanupResult = await getSupabaseAdmin().rpc("release_expired_star_authorizations_v200", { p_limit: 25 }).abortSignal(AbortSignal.timeout(1_500));
      if (cleanupResult.error) console.error("store reservation cleanup", cleanupResult.error);
    } catch (cleanupError) {
      console.error("store reservation cleanup", cleanupError);
    }
  });

  const supabase = getSupabaseAdmin();
  try {
    const [catalog, accountState] = await Promise.all([
      getStoreStaticCatalog(),
      loadStoreAccountState(supabase, String(profile.id)),
    ]);
    const snapshot = accountState.snapshot;
    if (!snapshot.wallet || typeof snapshot.wallet !== "object" || Array.isArray(snapshot.wallet)) {
      return NextResponse.json({ error: "Данные кошелька повреждены", code: "DATA_INTEGRITY" }, { status: 500 });
    }

    const products = normalizeCatalogProducts(catalog.products, runtimeConfig.featureFlags.memecoins);
    const caseOdds = buildCaseOdds(catalog.loot);
    const migrationReady = products.some((product) => product.sku === "case_vault")
      && products.some((product) => product.sku === "profile_founder_frame")
      && (caseOdds.case_vault?.length || 0) >= 5;

    return NextResponse.json({
      products,
      wallet: snapshot.wallet,
      inventory: Array.isArray(snapshot.inventory) ? snapshot.inventory : [],
      entitlements: Array.isArray(snapshot.entitlements) ? snapshot.entitlements : [],
      profileItems: Array.isArray(snapshot.profileItems) ? snapshot.profileItems : [],
      mxmShop: Array.isArray(snapshot.mxmShop) ? snapshot.mxmShop : [],
      creatorCoins: Array.isArray(snapshot.creatorCoins) ? snapshot.creatorCoins : [],
      caseOdds,
      caseAvailability: accountState.availability,
      currentSeason: accountState.season.season || null,
      starsEnabled: runtimeConfig.featureFlags.stars,
      migrationReady,
      migration: migrationReady ? undefined : "99999_store_battlepass_cases_v13.sql",
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("store payload", error);
    return apiFailure(error, "Не удалось загрузить магазин MXM");
  }
}
export const GET = withApiErrors("app/api/store/route.ts:GET", GETHandler);
