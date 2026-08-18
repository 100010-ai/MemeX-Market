import { NextResponse } from "next/server";
import { requireProfile, getProfileSnapshot } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapGift } from "@/lib/mappers";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const [coinsResult, giftsResult] = await Promise.all([
    supabase.from("holdings").select("coin_id,quantity,cost_basis,coins(name,symbol,current_price)").eq("profile_id", profile.id).gt("quantity", 0),
    supabase.from("gift_market_overview").select("*").eq("owner_profile_id", profile.id).order("created_at", { ascending: false }),
  ]);
  const firstError = coinsResult.error || giftsResult.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

  const holdings = (coinsResult.data || []).map((row: any) => {
    const coin = Array.isArray(row.coins) ? row.coins[0] : row.coins;
    const quantity = Number(row.quantity);
    const currentPrice = Number(coin?.current_price || 0);
    const marketValue = quantity * currentPrice;
    const costBasis = Number(row.cost_basis);
    return {
      coinId: row.coin_id,
      name: coin?.name || "Coin",
      symbol: coin?.symbol || "?",
      quantity,
      currentPrice,
      marketValue,
      costBasis,
      pnl: marketValue - costBasis,
    };
  });

  return NextResponse.json({ holdings, gifts: (giftsResult.data || []).map(mapGift), profile: await getProfileSnapshot(profile) });
}
