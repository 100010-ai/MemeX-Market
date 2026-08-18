import { NextResponse } from "next/server";
import { requireProfile, getProfileSnapshot } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapGift } from "@/lib/mappers";

function relationOne(value: any, label: string) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row) throw new Error(`${label} relation is missing`);
  return row;
}

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  try {
    const [coinsResult, giftsResult, coinHistoryResult, giftHistoryResult] = await Promise.all([
      supabase.from("holdings").select("coin_id,quantity,cost_basis,coins(name,symbol,current_price)").eq("profile_id", profile.id).gt("quantity", 0),
      supabase.from("gift_market_overview").select("*").eq("owner_profile_id", profile.id).order("created_at", { ascending: false }),
      supabase.from("trades").select("id,coin_id,side,quote_amount,realized_pnl,created_at,coins(symbol)").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(40),
      supabase.from("gift_trades").select("id,virtual_gift_id,buyer_profile_id,seller_profile_id,price,realized_pnl,created_at,gift_assets(base_name,gift_number)").or(`buyer_profile_id.eq.${profile.id},seller_profile_id.eq.${profile.id}`).order("created_at", { ascending: false }).limit(40),
    ]);
    const firstError = coinsResult.error || giftsResult.error || coinHistoryResult.error || giftHistoryResult.error;
    if (firstError) throw firstError;
    const holdings = (coinsResult.data || []).map((row: any) => {
      const coin = relationOne(row.coins, "Portfolio coin");
      const quantity = Number(row.quantity);
      const currentPrice = Number(coin.current_price);
      const marketValue = quantity * currentPrice;
      const costBasis = Number(row.cost_basis);
      return { coinId: String(row.coin_id), name: coin.name, symbol: coin.symbol, quantity, currentPrice, marketValue, costBasis, pnl: marketValue - costBasis };
    });
    const history = [
      ...(coinHistoryResult.data || []).map((row: any) => {
        const coin = relationOne(row.coins, "Coin history");
        if (typeof coin.symbol !== "string" || !coin.symbol) throw new Error("Coin history symbol is missing");
        return { id: `coin-${row.id}`, kind: "coin", label: `${row.side === "buy" ? "Bought" : "Sold"} $${coin.symbol}`, amount: Number(row.quote_amount), pnl: Number(row.realized_pnl), createdAt: row.created_at, href: `/coin/${row.coin_id}` };
      }),
      ...(giftHistoryResult.data || []).map((row: any) => {
        const gift = relationOne(row.gift_assets, "Gift history");
        if (typeof gift.base_name !== "string" || !gift.base_name || !Number.isFinite(Number(gift.gift_number))) throw new Error("Gift history metadata is missing");
        const sold = String(row.seller_profile_id) === String(profile.id);
        return { id: `gift-${row.id}`, kind: "gift", label: `${sold ? "Sold" : "Bought"} ${gift.base_name} #${Number(gift.gift_number)}`, amount: Number(row.price), pnl: sold ? Number(row.realized_pnl) : 0, createdAt: row.created_at, href: `/gifts/${row.virtual_gift_id}` };
      }),
    ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 50);
    return NextResponse.json({ holdings, gifts: (giftsResult.data || []).map(mapGift), profile: await getProfileSnapshot(profile), history });
  } catch (error) {
    console.error("portfolio", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load portfolio" }, { status: 500 });
  }
}
