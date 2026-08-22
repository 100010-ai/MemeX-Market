import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { nonEmptyId, nullableText, text } from "@/lib/safe-data";

const columns = {
  overall: "net_worth",
  pnl: "realized_pnl",
  giftPnl: "gift_realized_pnl",
  coinPnl: "coin_realized_pnl",
  gifts: "gift_value",
  coins: "created_coin_market_cap",
} as const;

type BoardKey = keyof typeof columns;

type LeaderboardCacheEntry = { expiresAt: number; rows: Array<Record<string, unknown>> };
const leaderboardCache = new Map<string, LeaderboardCacheEntry>();
const leaderboardInFlight = new Map<string, Promise<Array<Record<string, unknown>>>>();

async function getTopRows(supabase: ReturnType<typeof getSupabaseAdmin>, board: BoardKey, column: string, limit: number) {
  const key = `${board}:${limit}`;
  const cached = leaderboardCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  let pending = leaderboardInFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const result = await supabase.from("leaderboard")
        .select("id,username,first_name,photo_url,balance,coin_value,gift_value,net_worth,realized_pnl,coin_realized_pnl,gift_realized_pnl,coin_trade_count,gift_trade_count,gift_count,created_coin_market_cap")
        .order(column, { ascending: false }).order("id", { ascending: true }).limit(limit);
      if (result.error) throw result.error;
      return (result.data || []) as Array<Record<string, unknown>>;
    })();
    leaderboardInFlight.set(key, pending);
  }
  let rows: Array<Record<string, unknown>>;
  try { rows = await pending; }
  finally { if (leaderboardInFlight.get(key) === pending) leaderboardInFlight.delete(key); }
  leaderboardCache.set(key, { expiresAt: Date.now() + 5_000, rows });
  if (leaderboardCache.size > 18) {
    for (const [cacheKey, entry] of leaderboardCache) if (entry.expiresAt <= Date.now()) leaderboardCache.delete(cacheKey);
  }
  return rows;
}

function numeric(row: Record<string, unknown>, key: string) {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

async function GETHandler(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });

  const raw = request.nextUrl.searchParams.get("board") || "overall";
  const board: BoardKey = raw in columns ? raw as BoardKey : "overall";
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(5, Math.min(100, Math.floor(requestedLimit))) : 100;
  const column = columns[board];
  const supabase = getSupabaseAdmin();

  try {
    const [data, { data: me, error: meError }] = await Promise.all([
      getTopRows(supabase, board, column, limit),
      supabase.from("leaderboard").select("id,net_worth,realized_pnl,gift_realized_pnl,coin_realized_pnl,gift_value,created_coin_market_cap").eq("id", profile.id).maybeSingle(),
    ]);
    if (meError) throw meError;

    const validPlayers: Array<{ id: string; player: Record<string, unknown>; name: string }> = data.flatMap((player) => {
      const id = nonEmptyId(player.id);
      if (!id) return [];
      const username = text(player.username, "", 64);
      const name = username ? `@${username}` : text(player.first_name, "Пользователь", 120);
      return [{ id, player, name }];
    });
    const presentationById = new Map<string, string | null>();
    const playerIds = validPlayers.map(({ id }) => id);
    if (playerIds.length) {
      const { data: presentation, error: presentationError } = await supabase.from("profiles")
        .select("id,equipped_profile_frame")
        .in("id", playerIds);
      if (presentationError) throw presentationError;
      for (const row of presentation || []) {
        const rowId = nonEmptyId(row.id);
        if (rowId) presentationById.set(rowId, nullableText(row.equipped_profile_frame, 120));
      }
    }

    let previousValue: number | null = null;
    let previousRank = 0;
    const players = validPlayers.map(({ id, player, name }, index) => {
      const value = numeric(player, column);
      const rank = previousValue != null && value === previousValue ? previousRank : index + 1;
      previousValue = value;
      previousRank = rank;
      return ({
      rank,
      id,
      isMe: id === String(profile.id),
      name,
      photoUrl: nullableText(player.photo_url, 2_000),
      equippedFrame: presentationById.get(id) || null,
      balance: numeric(player, "balance"),
      coinValue: numeric(player, "coin_value"),
      giftValue: numeric(player, "gift_value"),
      netWorth: numeric(player, "net_worth"),
      realizedPnl: numeric(player, "realized_pnl"),
      coinRealizedPnl: numeric(player, "coin_realized_pnl"),
      giftRealizedPnl: numeric(player, "gift_realized_pnl"),
      coinTrades: numeric(player, "coin_trade_count"),
      giftTrades: numeric(player, "gift_trade_count"),
      giftCount: numeric(player, "gift_count"),
      createdCoinMarketCap: numeric(player, "created_coin_market_cap"),
    });
    });

    let meRank: number | null = players.find((player) => player.isMe)?.rank ?? null;
    if (meRank == null && me) {
      const meValue = numeric(me as Record<string, unknown>, column);
      const { count, error: countError } = await supabase.from("leaderboard").select("id", { count: "exact", head: true }).gt(column, meValue);
      if (countError) throw countError;
      meRank = Number(count || 0) + 1;
    }

    return NextResponse.json({ board, players, meRank }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("leaderboard", error);
    return apiFailure(error, "Не удалось загрузить рейтинг");
  }
}
export const GET = withApiErrors("app/api/leaderboard/route.ts:GET", GETHandler);
