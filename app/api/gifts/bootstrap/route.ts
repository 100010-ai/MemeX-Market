import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { syncTonApiGiftCatalog } from "@/lib/tonapi-gifts";
import { ensureGenesisGiftMarket } from "@/lib/npc-market";

export const runtime = "nodejs";
export const maxDuration = 60;

function friendlyBootstrapError(error: unknown) {
  const message = error instanceof Error ? error.message : "Не удалось загрузить Telegram Gifts";
  if (/tonapi_catalog_state|tonapi_gift_collections|acquire_tonapi_catalog_lock|chain_nft_address|chain_verified|model_preview_url|reconcile_npc_external_prices/i.test(message)) {
    return "База данных не обновлена до актуальной схемы Gifts. Примените миграции 014_v012_tonapi_polish.sql и 015_v014_real_prices_animations.sql.";
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

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "gift-market-bootstrap", String(profile.id), 4, 300))) {
    return NextResponse.json({ error: "Каталог уже обновляется. Подождите немного и повторите." }, { status: 429 });
  }

  try {
    const before = await listedCount();
    if (before > 0) return NextResponse.json({ ok: true, skipped: true, listed: before });

    const recentFailure = await recentTonApiFailure();
    if (recentFailure) {
      return NextResponse.json(
        { error: "TonAPI недавно вернул ошибку. Повторите загрузку через несколько секунд." },
        { status: 503, headers: { "retry-after": "30" } },
      );
    }

    // Keep network work out of GET /api/market. Import a few real Telegram Gift
    // collections in one bounded mutation, then release a finite Genesis batch.
    const catalog = await syncTonApiGiftCatalog({
      bootstrapOnly: true,
      maxCollections: 3,
      itemsPerCollection: process.env.TONAPI_KEY?.trim() ? 240 : 160,
    });

    // Another request may already own the global TonAPI lock. Do not race it
    // with an empty Genesis initialization; briefly wait for that bootstrap to
    // publish listings and then return the shared result.
    if (catalog.skipped) {
      const concurrentListed = await waitForConcurrentBootstrap();
      if (concurrentListed > 0) return NextResponse.json({ ok: true, skipped: true, listed: concurrentListed, catalog });
      return NextResponse.json({ error: "Каталог Gifts уже загружается. Повторите через несколько секунд." }, { status: 409 });
    }

    const genesis = await ensureGenesisGiftMarket({ batchSize: 120, force: true });
    const listed = await listedCount();

    if (listed <= 0) {
      const detail = catalog.errors?.[0] || "TonAPI не вернул подходящие Telegram Gift NFT";
      return NextResponse.json({ error: detail, catalog, genesis, listed }, { status: 502 });
    }

    return NextResponse.json({ ok: true, skipped: false, listed, catalog, genesis });
  } catch (error) {
    console.error("gift market bootstrap", error);
    return NextResponse.json({ error: friendlyBootstrapError(error) }, { status: 502 });
  }
}
