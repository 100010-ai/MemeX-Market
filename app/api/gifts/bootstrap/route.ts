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
  const message = error instanceof Error ? error.message : "Не удалось загрузить подарки Telegram";
  if (/TonAPI (401|403)/i.test(message)) {
    return "TonAPI отклонил TONAPI_KEY. MX Market попробует публичный режим автоматически; если ошибка повторяется, удалите невалидный TONAPI_KEY или выпустите новый ключ в TonConsole.";
  }
  if (/fetch|network|timeout|abort|TonAPI 429|TonAPI 5\d\d/i.test(message)) {
    return "TonAPI временно недоступен или ограничил запросы. Повторите загрузку через несколько секунд.";
  }
  return message;
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

async function waitForConcurrentBootstrap(maxWaitMs = 18_000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
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

    // Keep this request deliberately bounded. A previous production version
    // attempted up to 18 collections x 500 items after three discovery pages
    // and hit Vercel's 60-second function timeout. Bootstrap is incremental,
    // so smaller batches are safer and later calls continue from next_offset.
    const hasTonApiKey = Boolean(process.env.TONAPI_KEY?.trim());
    const catalog = await syncTonApiGiftCatalog({
      bootstrapOnly: false,
      discoverPages: 1,
      maxCollections: hasTonApiKey ? 6 : 3,
      itemsPerCollection: hasTonApiKey ? 240 : 120,
    });

    // Another request may already own the global TonAPI lock. Do not race it
    // with an empty Genesis initialization; briefly wait for that bootstrap to
    // publish listings and then return the shared result.
    if (catalog.skipped) {
      const concurrentListed = await waitForConcurrentBootstrap();
      if (concurrentListed > 0) return NextResponse.json({ ok: true, skipped: true, listed: concurrentListed, catalog });
      return NextResponse.json({ ok: true, pending: true, skipped: true, listed: 0, catalog, retryAfterMs: 5000 }, { status: 202, headers: { "retry-after": "5" } });
    }

    // Genesis is incremental too. Avoid making the same request perform a
    // second oversized database batch after the network import has completed.
    const genesis = await ensureGenesisGiftMarket({ batchSize: 350, force: true });
    const listed = await listedCount();

    if (listed <= 0) {
      const detail = catalog.errors?.[0] || "TonAPI не вернул подходящие Telegram Gift NFT";
      return NextResponse.json({ error: detail, catalog, genesis, listed }, { status: 502 });
    }

    return NextResponse.json({ ok: true, skipped: false, listed, catalog, genesis });
  } catch (error) {
    if (isDatabaseSchemaError(error)) return apiFailure(error, "Схема подарков требует актуальной production-миграции");
    console.error("gift market bootstrap", error);
    return NextResponse.json({ error: friendlyBootstrapError(error) }, { status: 502 });
  }
}
export const POST = withApiErrors("app/api/gifts/bootstrap/route.ts:POST", POSTHandler);
