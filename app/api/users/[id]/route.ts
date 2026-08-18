import { NextResponse } from "next/server";
import { requireProfile, tierForWorth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapCoin, mapGift } from "@/lib/mappers";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireProfile();
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  try {
    const [leaderResult, profileResult, coinsResult, giftsResult] = await Promise.all([
      supabase.from("leaderboard").select("*").eq("id", id).maybeSingle(),
      supabase.from("profiles").select("id,username,first_name,photo_url,created_at").eq("id", id).maybeSingle(),
      supabase.from("market_overview").select("*").eq("creator_profile_id", id).order("market_cap", { ascending: false }).limit(12),
      supabase.from("gift_market_overview").select("*").eq("owner_profile_id", id).not("telegram_name", "is", null).not("model_file_id", "is", null).not("symbol_file_id", "is", null).order("estimated_value", { ascending: false, nullsFirst: false }).limit(8),
    ]);
    const error = leaderResult.error || profileResult.error || coinsResult.error || giftsResult.error;
    if (error) throw error;
    if (!leaderResult.data || !profileResult.data) return NextResponse.json({ error: "Player not found" }, { status: 404 });
    const rankResult = await supabase.from("leaderboard").select("id", { count: "exact", head: true }).gt("net_worth", Number(leaderResult.data.net_worth));
    if (rankResult.error) throw rankResult.error;
    const row: any = leaderResult.data;
    const person: any = profileResult.data;
    return NextResponse.json({
      profile: {
        id: String(person.id),
        name: person.username ? `@${person.username}` : person.first_name,
        username: person.username || null,
        firstName: person.first_name,
        photoUrl: person.photo_url || null,
        joinedAt: person.created_at,
        tier: tierForWorth(Number(row.net_worth)),
        rank: Number(rankResult.count || 0) + 1,
        netWorth: Number(row.net_worth),
        realizedPnl: Number(row.realized_pnl),
        coinValue: Number(row.coin_value),
        giftValue: Number(row.gift_value),
        tradeCount: Number(row.coin_trade_count) + Number(row.gift_trade_count),
        giftCount: Number(row.gift_count),
        createdCoins: (coinsResult.data || []).map(mapCoin),
        showcase: (giftsResult.data || []).map(mapGift),
      },
    });
  } catch (error) {
    console.error("public profile", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load player" }, { status: 500 });
  }
}
