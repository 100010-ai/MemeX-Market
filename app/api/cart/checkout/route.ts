import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "cart-checkout", String(profile.id), 12, 60))) return NextResponse.json({ error: "Слишком много попыток покупки" }, { status: 429 });
  const supabase = getSupabaseAdmin();
  const cart = await supabase.from("market_cart_items").select("virtual_gift_id").eq("profile_id", profile.id).order("added_at", { ascending: true }).limit(20);
  if (cart.error) return NextResponse.json({ error: cart.error.message }, { status: 500 });
  const ids = (cart.data || []).map((row) => String(row.virtual_gift_id));
  if (!ids.length) return NextResponse.json({ error: "Корзина пуста" }, { status: 409 });
  const result = await supabase.rpc("buy_virtual_gift_cart", { p_buyer_id: profile.id, p_virtual_gift_ids: ids });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 409 });
  return NextResponse.json(result.data);
}
