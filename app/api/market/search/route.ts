import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { looseRowsQuery } from "@/lib/supabase/loose-query";
import { giftMarketSelect, mapCoin, mapGift, mapGiftCollection } from "@/lib/mappers";
import { nonEmptyId, nullableText, text } from "@/lib/safe-data";
import { enforceRateLimit } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";

function cleanTerm(value: string) {
  // `.or()` accepts raw PostgREST filter syntax. Keep search input to display
  // characters only so user text can never become an extra filter operator.
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[^\p{L}\p{N}\s@#$._-]/gu, " ")
    .replace(/\s+/g, " ")
    .slice(0, 64);
}

function profileName(row: { username?: unknown; first_name?: unknown }) {
  if (typeof row.username === "string" && row.username.trim()) return `@${row.username.trim()}`;
  if (typeof row.first_name === "string" && row.first_name.trim()) return row.first_name.trim();
  return "Игрок";
}

async function GETHandler(request: NextRequest) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!(await enforceRateLimit(request, "market-search", String(session.telegramId), 80, 60))) return NextResponse.json({ error: "Слишком много поисковых запросов" }, { status: 429 });

  const q = cleanTerm(request.nextUrl.searchParams.get("q") || "");
  if (q.length < 2) return NextResponse.json({ gifts: [], coins: [], collections: [], users: [] });

  const supabase = getSupabaseAdmin();
  const runtimeConfig = await getRuntimeConfig();
  const liquidityResult = await supabase.rpc("gift_market_liquidity_state");
  if (liquidityResult.error) return apiFailure(liquidityResult.error, "Не удалось проверить режим рынка подарков");
  const playerOnly = Boolean((liquidityResult.data as { playerOnly?: boolean } | null)?.playerOnly);
  let systemOwnerIds: string[] = [];
  if (playerOnly) {
    const systemProfiles = await supabase.from("profiles").select("id").eq("is_system", true);
    if (systemProfiles.error) return apiFailure(systemProfiles.error, "Не удалось проверить владельцев рынка");
    systemOwnerIds = (systemProfiles.data || []).map((row) => String(row.id)).filter(Boolean);
  }
  const nowIso = new Date().toISOString();
  // Search maps rows through a runtime-safe Record mapper. Widen the builder
  // before composing the large view query so Supabase's recursive type-level
  // select/filter parser cannot hit TS2589 during `next build`.
  const baseQuery = () => {
    const query = looseRowsQuery<Record<string, unknown>>(supabase.from("gift_market_overview"))
      .select(giftMarketSelect)
      .eq("status", "listed")
      .eq("is_burned", false)
      .or(`listing_expires_at.is.null,listing_expires_at.gt.${nowIso}`)
      .not("telegram_name", "is", null);

    // Return a fresh builder instead of reassigning it. Reassignment after a
    // conditional `.not()` is another known trigger for Supabase TS2589.
    return systemOwnerIds.length
      ? query.not("owner_profile_id", "in", `(${systemOwnerIds.join(",")})`)
      : query;
  };

  const giftTerm = q.replace(/^#/, "");
  const coinTerm = q.replace(/^\$/, "");
  const userTerm = q.replace(/^@/, "");
  const pattern = `%${giftTerm}%`;
  const giftRequests = [
    baseQuery().ilike("base_name", pattern).order("listing_price", { ascending: true }).limit(24),
    baseQuery().ilike("model_name", pattern).order("listing_price", { ascending: true }).limit(12),
    baseQuery().ilike("backdrop_name", pattern).order("listing_price", { ascending: true }).limit(12),
    baseQuery().ilike("symbol_name", pattern).order("listing_price", { ascending: true }).limit(12),
  ];
  if (/^#?\d+$/.test(q)) {
    const number = Number(q.replace("#", ""));
    if (Number.isSafeInteger(number) && number > 0) giftRequests.unshift(baseQuery().eq("gift_number", number).order("listing_price", { ascending: true }).limit(24));
  }

  const [giftResults, coinsResult, collectionsResult, usersResult] = await Promise.all([
    Promise.all(giftRequests),
    supabase.from("market_overview")
      .select("id,creator_profile_id,name,symbol,image_url,description,current_price,market_cap,volume_24h,change_24h,holder_count,trade_count_24h,created_at,creator_name,liquidity,all_time_volume,ath_price,buy_volume_24h,sell_volume_24h,total_supply,token_reserve,quote_reserve")
      .eq("status", "active").or(`name.ilike.%${coinTerm}%,symbol.ilike.%${coinTerm}%`).order("volume_24h", { ascending: false }).limit(12),
    supabase.from("gift_collection_overview")
      .select("base_name,item_count,holder_count,listed_count,floor_price,volume_24h,change_24h,trade_count_24h")
      .ilike("base_name", `%${giftTerm}%`).order("volume_24h", { ascending: false }).limit(12),
    supabase.from("profiles")
      .select("id,username,first_name,photo_url,created_at")
      .eq("is_system", false).or(`username.ilike.%${userTerm}%,first_name.ilike.%${userTerm}%`).order("created_at", { ascending: false }).limit(12),
  ]);

  const giftError = giftResults.find((result) => result.error)?.error;
  const error = giftError || coinsResult.error || collectionsResult.error || usersResult.error;
  if (error) return apiFailure(error, "Не удалось выполнить поиск");

  const unique = new Map<string, Record<string, unknown>>();
  for (const result of giftResults) {
    for (const row of result.data || []) {
      const record = row as unknown as Record<string, unknown>;
      const id = String(record.virtual_gift_id || "");
      if (id && !unique.has(id)) unique.set(id, record);
      if (unique.size >= 60) break;
    }
    if (unique.size >= 60) break;
  }

  return NextResponse.json({
    gifts: runtimeConfig.featureFlags.gifts ? [...unique.values()].map(mapGift).filter((gift) => Boolean(gift.virtualGiftId)) : [],
    coins: runtimeConfig.featureFlags.memecoins ? (coinsResult.data || []).map(mapCoin).filter((coin) => Boolean(coin.id)) : [],
    collections: runtimeConfig.featureFlags.gifts ? (collectionsResult.data || []).map((row) => mapGiftCollection(row as unknown as Record<string, unknown>)).filter((collection) => Boolean(collection.baseName)) : [],
    users: (usersResult.data || []).flatMap((row) => {
      const id = nonEmptyId(row.id);
      if (!id) return [];
      return [{ id, name: profileName(row), username: nullableText(row.username, 64), firstName: text(row.first_name, "Игрок", 120), photoUrl: nullableText(row.photo_url, 2_000) }];
    }),
  }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
}
export const GET = withApiErrors("app/api/market/search/route.ts:GET", GETHandler);
