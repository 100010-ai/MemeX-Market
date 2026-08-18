import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "gift-buy", String(profile.id), 45, 60))) return NextResponse.json({ error: "Слишком много запросов. Подождите немного." }, { status: 429 });
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("buy_virtual_gift", { p_buyer_id: profile.id, p_virtual_gift_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await supabase.from("market_cart_items").delete().eq("virtual_gift_id", id);
  return NextResponse.json({ trade: data });
}
