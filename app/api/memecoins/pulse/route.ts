import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCoin } from "@/lib/mappers";
import { finiteNumber, nonEmptyId, nullableText, safeIsoDate, text } from "@/lib/safe-data";

type Board = "hot" | "gainers" | "new" | "verified";
const boards = new Set<Board>(["hot","gainers","new","verified"]);

async function GETHandler(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const raw = request.nextUrl.searchParams.get("board") || "hot";
  const board: Board = boards.has(raw as Board) ? raw as Board : "hot";
  const requested = Number(request.nextUrl.searchParams.get("limit") || 40);
  const limit = Number.isFinite(requested) ? Math.max(6, Math.min(80, Math.floor(requested))) : 40;
  const supabase = getSupabaseAdmin();
  try {
    let query = supabase.from("coin_discovery_v0730").select("id,creator_profile_id,name,symbol,image_url,description,current_price,market_cap,volume_24h,change_24h,holder_count,trade_count_24h,created_at,creator_name,liquidity,all_time_volume,ath_price,buy_volume_24h,sell_volume_24h,total_supply,token_reserve,quote_reserve,unique_traders_24h,unique_traders_all,last_public_trade_at,top_trader_share_bps,heat_score,coin_level,heat_tier,coin_level_key").eq("status","active");
    if (board === "hot") query = query.order("heat_score", { ascending: false }).order("volume_24h", { ascending: false });
    else if (board === "gainers") query = query.order("change_24h", { ascending: false }).order("volume_24h", { ascending: false });
    else if (board === "new") query = query.order("created_at", { ascending: false });
    else query = query.order("heat_score", { ascending: false });
    const rowsResult = await query.limit(board === "verified" ? Math.min(100, limit * 3) : limit);
    if (rowsResult.error) throw rowsResult.error;
    const ids = (rowsResult.data || []).map((row) => nonEmptyId(row.id)).filter((id): id is string => Boolean(id));
    const verificationResult = ids.length ? await supabase.from("coin_verifications_v071").select("coin_id,tier,verified_at,revoked_at").in("coin_id", ids).is("revoked_at", null) : { data: [], error: null };
    if (verificationResult.error) throw verificationResult.error;
    const verified = new Map((verificationResult.data || []).map((row) => [String(row.coin_id), { tier: text(row.tier,"verified",40), verifiedAt: safeIsoDate(row.verified_at) }]));
    const source = board === "verified" ? (rowsResult.data || []).filter((row) => verified.has(String(row.id))).slice(0, limit) : (rowsResult.data || []);
    const coins = source.map((row) => {
      const coin = mapCoin(row);
      const verification = verified.get(coin.id) || null;
      return {
        ...coin,
        uniqueTraders24h: Math.max(0, Math.floor(finiteNumber(row.unique_traders_24h))),
        uniqueTradersAll: Math.max(0, Math.floor(finiteNumber(row.unique_traders_all))),
        lastTradeAt: nullableText(row.last_public_trade_at, 100),
        topTraderShareBps: Math.max(0, Math.min(10_000, Math.floor(finiteNumber(row.top_trader_share_bps)))),
        heatScore: Math.max(0, Math.min(100, Math.floor(finiteNumber(row.heat_score)))),
        heatTier: text(row.heat_tier,"quiet",24),
        level: Math.max(1, Math.min(5, Math.floor(finiteNumber(row.coin_level,1)))),
        levelKey: text(row.coin_level_key,"launch",32),
        verified: Boolean(verification), verificationTier: verification?.tier || null,
      };
    });
    const totals = {
      coins: coins.length,
      volume24h: coins.reduce((sum, coin) => sum + coin.volume24h, 0),
      traders24h: coins.reduce((sum, coin) => sum + coin.uniqueTraders24h, 0),
      verified: coins.filter((coin) => coin.verified).length,
    };
    return NextResponse.json({ board, coins, totals }, { headers: { "cache-control": "private, max-age=5, stale-while-revalidate=15" } });
  } catch (error) { return apiFailure(error, "Не удалось загрузить Pulse мемкоинов"); }
}
export const GET = withApiErrors("app/api/memecoins/pulse/route.ts:GET", GETHandler);
