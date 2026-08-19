import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "virtual-game", String(profile.id), 60, 60))) return NextResponse.json({ error: "Слишком много раундов. Подожди немного." }, { status: 429 });
  const body = await request.json().catch(() => ({}));
  const game = ["coinflip","dice","wheel","slots","hilo","roulette","plinko"].includes(body.game) ? String(body.game) : "";
  const bet = Number(body.bet);
  const choice = body.choice == null ? null : String(body.choice);
  const requestKey = typeof body.requestKey === "string" && body.requestKey.length <= 120 ? body.requestKey : null;
  if (!game || !Number.isFinite(bet) || bet <= 0) return NextResponse.json({ error: "Некорректная ставка" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("play_virtual_game", { p_profile_id: profile.id, p_game: game, p_bet: bet, p_choice: choice, p_request_key: requestKey });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ round: data }, { headers: { "cache-control": "no-store" } });
}
