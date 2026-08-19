import { NextResponse } from "next/server";
import { requireProfile, getProfileSnapshot } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const [rounds, snapshot] = await Promise.all([
    supabase.from("game_rounds").select("id,game,bet,choice,outcome,multiplier,payout,balance_after,created_at").eq("profile_id", profile.id).order("created_at", { ascending: false }).limit(30),
    getProfileSnapshot(profile as Record<string, unknown>),
  ]);
  if (rounds.error) return NextResponse.json({ error: rounds.error.message }, { status: 500 });
  type GameRoundRow = {
    id: string; game: string; bet: string | number; choice: string | null; outcome: { result?: unknown; number?: unknown } | null;
    multiplier: string | number; payout: string | number; balance_after: string | number; created_at: string;
  };
  const rows = (rounds.data || []) as GameRoundRow[];
  return NextResponse.json({
    balance: snapshot.balance,
    availableBalance: snapshot.availableBalance,
    reservedBalance: snapshot.reservedBalance,
    rounds: rows.map((row) => ({
      id: String(row.id), game: String(row.game), bet: Number(row.bet), choice: row.choice == null ? null : String(row.choice),
      result: String(row.outcome?.result ?? ""), number: row.outcome?.number == null ? null : Number(row.outcome.number),
      multiplier: Number(row.multiplier), payout: Number(row.payout), balanceAfter: Number(row.balance_after), createdAt: String(row.created_at),
    })),
  }, { headers: { "cache-control": "private, no-store" } });
}
