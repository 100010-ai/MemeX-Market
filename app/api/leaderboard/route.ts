import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const columns = {
  overall: "net_worth",
  pnl: "realized_pnl",
  gifts: "gift_value",
  coins: "created_coin_market_cap",
} as const;

type BoardKey = keyof typeof columns;

export async function GET(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const raw = request.nextUrl.searchParams.get("board") || "overall";
  const board: BoardKey = raw in columns ? raw as BoardKey : "overall";
  const column = columns[board];
  const supabase = getSupabaseAdmin();
  try {
    const [{ data, error }, { data: me, error: meError }] = await Promise.all([
      supabase.from("leaderboard").select("*").order(column, { ascending: false }).limit(100),
      supabase.from("leaderboard").select("*").eq("id", profile.id).single(),
    ]);
    if (error || meError || !me) throw error || meError || new Error("Profile is missing from leaderboard");
    const meValue = Number((me as any)[column]);
    const { count, error: countError } = await supabase.from("leaderboard").select("id", { count: "exact", head: true }).gt(column, meValue);
    if (countError) throw countError;
    const players = (data || []).map((player: any, index: number) => ({
      rank: index + 1,
      id: String(player.id),
      isMe: String(player.id) === String(profile.id),
      name: player.username ? `@${player.username}` : player.first_name,
      photoUrl: player.photo_url || null,
      balance: Number(player.balance),
      coinValue: Number(player.coin_value),
      giftValue: Number(player.gift_value),
      netWorth: Number(player.net_worth),
      realizedPnl: Number(player.realized_pnl),
      coinTrades: Number(player.coin_trade_count),
      giftTrades: Number(player.gift_trade_count),
      giftCount: Number(player.gift_count),
      createdCoinMarketCap: Number(player.created_coin_market_cap),
    }));
    return NextResponse.json({ board, players, meRank: Number(count || 0) + 1 });
  } catch (error) {
    console.error("leaderboard", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load leaderboard" }, { status: 500 });
  }
}
