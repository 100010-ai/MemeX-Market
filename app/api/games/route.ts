import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();

  // Games only need spendable cash, not the expensive full portfolio valuation.
  // Fetch history + reserved offers in parallel and reuse the balance already
  // returned by requireProfile(). This removes one financial-view query from
  // the hot path every time the Games screen opens.
  const [rounds, reservedResult] = await Promise.all([
    supabase.from("game_rounds").select("id,game,bet,choice,outcome,multiplier,payout,balance_after,created_at").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(12),
    supabase.rpc("pending_gift_offer_total", { p_profile_id: profile.id, p_exclude_virtual_gift_id: null }),
  ]);
  const firstError = rounds.error || reservedResult.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

  type GameRoundRow = {
    id: string;
    game: string;
    bet: string | number;
    choice: string | null;
    outcome: { result?: unknown; number?: unknown; visual?: unknown } | null;
    multiplier: string | number;
    payout: string | number;
    balance_after: string | number;
    created_at: string;
  };
  const rows = (rounds.data || []) as GameRoundRow[];
  const balance = Number(profile.balance);
  const reservedBalance = Math.max(0, Number(reservedResult.data || 0));

  return NextResponse.json({
    balance,
    availableBalance: Math.max(0, balance - reservedBalance),
    reservedBalance,
    rounds: rows.map((row) => ({
      id: String(row.id),
      game: String(row.game),
      bet: Number(row.bet),
      choice: row.choice == null ? null : String(row.choice),
      result: String(row.outcome?.result ?? ""),
      number: row.outcome?.number == null ? null : Number(row.outcome.number),
      visual: row.outcome?.visual && typeof row.outcome.visual === "object" ? row.outcome.visual : null,
      multiplier: Number(row.multiplier),
      payout: Number(row.payout),
      balanceAfter: Number(row.balance_after),
      createdAt: String(row.created_at),
    })),
  }, { headers: { "cache-control": "private, no-store" } });
}
