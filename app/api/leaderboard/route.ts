import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

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
  if (!Number.isFinite(value)) throw new Error(`Leaderboard field ${key} is invalid`);
  return value;
}

export async function GET(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });

  const raw = request.nextUrl.searchParams.get("board") || "overall";
  const board: BoardKey = raw in columns ? raw as BoardKey : "overall";
  const column = columns[board];
  const supabase = getSupabaseAdmin();

  try {
    const [{ data, error }, { data: me, error: meError }] = await Promise.all([
      supabase.from("leaderboard").select("*").order(column, { ascending: false }).order("id", { ascending: true }).limit(100),
      supabase.from("leaderboard").select("*").eq("id", profile.id).maybeSingle(),
    ]);
    if (error || meError) throw error || meError;

    let meRank: number | null = null;
    if (me) {
      const meValue = numeric(me as Record<string, unknown>, column);
      const { count, error: countError } = await supabase.from("leaderboard").select("id", { count: "exact", head: true }).gt(column, meValue);
      if (countError) throw countError;
      meRank = Number(count || 0) + 1;
    }

    const players = (data || []).map((player: Record<string, unknown>, index: number) => {
      const name = typeof player.username === "string" && player.username
        ? `@${player.username}`
        : typeof player.first_name === "string" && player.first_name
          ? player.first_name
          : "Unknown";
      return {
        rank: index + 1,
        id: String(player.id),
        isMe: String(player.id) === String(profile.id),
        name,
        photoUrl: typeof player.photo_url === "string" && player.photo_url ? player.photo_url : null,
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
      };
    });

    return NextResponse.json({ board, players, meRank });
  } catch (error) {
    console.error("leaderboard", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить рейтинг" }, { status: 500 });
  }
}
