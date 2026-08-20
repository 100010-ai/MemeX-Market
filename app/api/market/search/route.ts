import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapCoin, mapGift } from "@/lib/mappers";
import { enforceRateLimit } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";

function cleanTerm(value: string) {
  return value.trim().replace(/[,%()]/g, " ").replace(/\s+/g, " ").slice(0, 64);
}

function profileName(row: { username?: unknown; first_name?: unknown }) {
  if (typeof row.username === "string" && row.username.trim()) return `@${row.username.trim()}`;
  if (typeof row.first_name === "string" && row.first_name.trim()) return row.first_name.trim();
  return "Игрок";
}

export async function GET(request: NextRequest) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await enforceRateLimit(request, "market-search", String(session.telegramId), 80, 60))) return NextResponse.json({ error: "Слишком много поисковых запросов" }, { status: 429 });

  const q = cleanTerm(request.nextUrl.searchParams.get("q") || "");
  if (q.length < 2) return NextResponse.json({ gifts: [], coins: [], collections: [], users: [] });

  const supabase = getSupabaseAdmin();
  const runtimeConfig = await getRuntimeConfig();
  const nowIso = new Date().toISOString();
  const baseQuery = () => supabase
    .from("gift_market_overview")
    .select(giftMarketSelect)
    .eq("status", "listed")
    .eq("is_burned", false)
    .or(`listing_expires_at.is.null,listing_expires_at.gt.${nowIso}`)
    .not("telegram_name", "is", null);

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
  if (error) {
    console.error("unified market search", error);
    return NextResponse.json({ error: "Не удалось выполнить поиск" }, { status: 500 });
  }

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
    gifts: runtimeConfig.featureFlags.gifts ? [...unique.values()].map((row) => mapGift(row as Record<string, any>)) : [],
    coins: runtimeConfig.featureFlags.memecoins ? (coinsResult.data || []).map(mapCoin) : [],
    collections: runtimeConfig.featureFlags.gifts ? (collectionsResult.data || []).map((row) => ({
      baseName: String(row.base_name), itemCount: Number(row.item_count), holderCount: Number(row.holder_count), listedCount: Number(row.listed_count),
      floorPrice: row.floor_price == null ? null : Number(row.floor_price), volume24h: Number(row.volume_24h), change24h: Number(row.change_24h), tradeCount24h: Number(row.trade_count_24h),
    })) : [],
    users: (usersResult.data || []).map((row) => ({ id: String(row.id), name: profileName(row), username: row.username || null, firstName: row.first_name, photoUrl: row.photo_url || null })),
  }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
}
