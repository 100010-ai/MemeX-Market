import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { nonEmptyId, nullableText, text } from "@/lib/safe-data";

type BoardKey = "overall" | "pnl" | "giftPnl" | "coinPnl" | "gifts" | "coins";
const boards = new Set<BoardKey>(["overall", "pnl", "giftPnl", "coinPnl", "gifts", "coins"]);
type Snapshot = { players?: unknown; meRank?: unknown };

function numeric(row: Record<string, unknown>, key: string) {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

async function GETHandler(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const raw = request.nextUrl.searchParams.get("board") || "overall";
  const board: BoardKey = boards.has(raw as BoardKey) ? raw as BoardKey : "overall";
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(5, Math.min(100, Math.floor(requestedLimit))) : 100;

  try {
    const { data, error } = await getSupabaseAdmin().rpc("leaderboard_snapshot_v200", {
      p_profile_id: profile.id,
      p_board: board,
      p_limit: limit,
    });
    if (error) throw error;
    const snapshot: Snapshot = data && typeof data === "object" && !Array.isArray(data) ? data as Snapshot : {};
    const rows = Array.isArray(snapshot.players) ? snapshot.players : [];
    const players = rows.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const player = value as Record<string, unknown>;
      const id = nonEmptyId(player.id);
      if (!id) return [];
      const username = text(player.username, "", 64);
      return [{
        rank: Math.max(1, Math.floor(numeric(player, "rank"))),
        id,
        isMe: id === String(profile.id),
        name: username ? `@${username}` : text(player.first_name, "Пользователь", 120),
        photoUrl: nullableText(player.photo_url, 2_000),
        equippedFrame: nullableText(player.equipped_profile_frame, 120),
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
        collectorScore: numeric(player, "collector_score"),
        uniqueCollections: numeric(player, "unique_collections"),
        rareGiftCount: numeric(player, "rare_gift_count"),
      }];
    });
    const rawMeRank = Number(snapshot.meRank);
    const meRank = Number.isFinite(rawMeRank) && rawMeRank > 0 ? Math.floor(rawMeRank) : null;
    return NextResponse.json({ board, players, meRank }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("leaderboard", error);
    return apiFailure(error, "Не удалось загрузить рейтинг");
  }
}
export const GET = withApiErrors("app/api/leaderboard/route.ts:GET", GETHandler);
