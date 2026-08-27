import { apiFailure, isDatabaseSchemaError, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { syncTonApiGiftCatalog } from "@/lib/tonapi-gifts";
import { ensureGenesisGiftMarket, getGiftMarketLiquidityState } from "@/lib/npc-market";

export const runtime = "nodejs";
export const maxDuration = 60;

function friendlyBootstrapError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/TonAPI (401|403)/i.test(message)) {
    return "TonAPI отклонил TONAPI_KEY. MX Market попробует публичный режим автоматически; если ошибка повторяется, удалите невалидный TONAPI_KEY или выпустите новый ключ в TonConsole.";
  }
  if (/fetch|network|timeout|abort|TonAPI 429|TonAPI 5\d\d/i.test(message)) {
    return "TonAPI временно недоступен или ограничил запросы. Повторите загрузку через несколько секунд.";
  }
  return "Не удалось обновить каталог подарков. Повторите позже.";
}

async function listedCount() {
  const supabase = getSupabaseAdmin();
  const result = await supabase.rpc("gift_market_listed_count");
  if (result.error) throw result.error;
  return Number(result.data || 0);
}

async function recentTonApiFailure() {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("tonapi_catalog_state")
    .select("last_sync_at,last_error")
    .eq("singleton", true)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data?.last_error || !result.data.last_sync_at) return null;
  const attemptedAt = new Date(String(result.data.last_sync_at)).getTime();
  if (!Number.isFinite(attemptedAt) || Date.now() - attemptedAt >= 30_000) return null;
  return String(result.data.last_error);
}

async function waitForConcurrentBootstrap(maxWaitMs = 6_000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const count = await listedCount();
    if (count > 0) return count;
  }
  return 0;
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "gift-market-bootstrap", String(profile.id), 4, 300))) {
    return NextResponse.json({ error: "Каталог уже обновляется. Подождите немного и повторите." }, { status: 429 });
  }

  try {
    const liquidity = await getGiftMarketLiquidityState();
    if (liquidity.playerOnly) {
      const listed = await listedCount();
      return NextResponse.json({ ok: true, skipped: true, playerOnly: true, listed, liquidity });
    }

    const before = await listedCount();
    if (before >= 600) return NextResponse.json({ ok: true, skipped: true, listed: before });

    const recentFailure = await recentTonApiFailure();
    if (recentFailure) {
      return NextResponse.json(
        { error: "TonAPI недавно вернул ошибку. Повторите загрузку через несколько секунд." },
        { status: 503, headers: { "retry-after": "30" } },
      );
    }

    // Bootstrap is deliberately incremental. Keep both the external request
    // count and the database batch small enough to leave headroom below the
    // 60-second Vercel function limit even when TonAPI retries once.
    const hasTonApiKey = Boolean(process.env.TONAPI_KEY?.trim());
    const catalog = await syncTonApiGiftCatalog({
      bootstrapOnly: false,
      discoverPages: 1,
      maxCollections: hasTonApiKey ? 2 : 1,
      itemsPerCollection: hasTonApiKey ? 160 : 80,
    });
    const { errors: catalogErrors, ...publicCatalog } = catalog;

    // Another request may already own the global TonAPI lock. Do not spend a
    // large part of this request polling: return 202 quickly and let the client
    // retry while the lock owner publishes the shared catalogue.
    if (catalog.skipped) {
      const concurrentListed = await waitForConcurrentBootstrap();
      if (concurrentListed > 0) return NextResponse.json({ ok: true, skipped: true, listed: concurrentListed, catalog: publicCatalog });
      return NextResponse.json({ ok: true, pending: true, skipped: true, listed: 0, catalog: publicCatalog, retryAfterMs: 5000 }, { status: 202, headers: { "retry-after": "5" } });
    }

    // Genesis is incremental too. Keep this follow-up batch bounded so the
    // request cannot turn a successful network import into a serverless timeout.
    const genesis = await ensureGenesisGiftMarket({ batchSize: 200, force: true });
    const listed = await listedCount();

    if (listed <= 0) {
      const firstCatalogError = catalogErrors?.[0];
      return NextResponse.json({ error: friendlyBootstrapError(firstCatalogError ? new Error(firstCatalogError) : null), catalog: publicCatalog, genesis, listed }, { status: 502 });
    }

    return NextResponse.json({ ok: true, skipped: false, listed, catalog: publicCatalog, genesis });
  } catch (error) {
    if (isDatabaseSchemaError(error)) return apiFailure(error, "Схема подарков требует актуальной production-миграции");
    console.error("gift market bootstrap", error);
    return NextResponse.json({ error: friendlyBootstrapError(error) }, { status: 502 });
  }
}
export const POST = withApiErrors("app/api/gifts/bootstrap/route.ts:POST", POSTHandler);
