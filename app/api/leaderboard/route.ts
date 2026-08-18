import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("leaderboard").select("*").order("net_worth", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const players = (data || []).map((p: any, index: number) => ({
    rank: index + 1,
    id: p.id,
    isMe: String(p.id) === String(profile.id),
    name: p.username ? `@${p.username}` : p.first_name,
    photoUrl: p.photo_url || null,
    balance: Number(p.balance),
    coinValue: Number(p.coin_value),
    giftValue: Number(p.gift_value),
    netWorth: Number(p.net_worth),
    pnl: Number(p.net_worth) - 100,
    coinTrades: Number(p.coin_trade_count),
    giftTrades: Number(p.gift_trade_count),
  }));
  return NextResponse.json({ players });
}
