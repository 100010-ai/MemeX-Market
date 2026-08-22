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
    const [{ data, error }, { data: me, error: meError }] = await Promise.all([
      supabase.from("leaderboard").select("id,username,first_name,photo_url,balance,coin_value,gift_value,net_worth,realized_pnl,coin_realized_pnl,gift_realized_pnl,coin_trade_count,gift_trade_count,gift_count,created_coin_market_cap").order(column, { ascending: false }).order("id", { ascending: true }).limit(limit),
      supabase.from("leaderboard").select("id,net_worth,realized_pnl,gift_realized_pnl,coin_realized_pnl,gift_value,created_coin_market_cap").eq("id", profile.id).maybeSingle(),
    ]);
    if (error || meError) throw error || meError;

    let meRank: number | null = null;
    if (me) {
      const meValue = numeric(me as Record<string, unknown>, column);
      const { count, error: countError } = await supabase.from("leaderboard").select("id", { count: "exact", head: true }).gt(column, meValue);
      if (countError) throw countError;
      meRank = Number(count || 0) + 1;
    }

    const validPlayers: Array<{ id: string; player: Record<string, unknown>; name: string }> = ((data || []) as Record<string, unknown>[]).flatMap((player) => {
      const id = nonEmptyId(player.id);
      if (!id) return [];
      const username = text(player.username, "", 64);
      const name = username ? `@${username}` : text(player.first_name, "Пользователь", 120);
      return [{ id, player, name }];
    });
    const players = validPlayers.map(({ id, player, name }, index) => ({
      rank: index + 1,
      id,
      isMe: id === String(profile.id),
      name,
      photoUrl: nullableText(player.photo_url, 2_000),
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
    }));

    return NextResponse.json({ board, players, meRank });
  } catch (error) {
    console.error("leaderboard", error);
    return apiFailure(error, "Не удалось загрузить рейтинг");
  }
}
export const GET = withApiErrors("app/api/leaderboard/route.ts:GET", GETHandler);
