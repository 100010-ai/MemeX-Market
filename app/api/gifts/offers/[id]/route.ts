import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  if (!(await enforceRateLimit(request, "gift-offer-resolve", String(profile.id), 50, 60))) return NextResponse.json({ error: "Слишком много операций. Попробуйте позже." }, { status: 429 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  const supabase = getSupabaseAdmin();
  if (action === "cancel") {
    const { error } = await supabase.rpc("cancel_gift_offer", { p_buyer_id: profile.id, p_offer_id: id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ status: "cancelled" });
  }
  if (action === "accept" || action === "reject") {
    const { data, error } = await supabase.rpc("resolve_gift_offer", { p_owner_id: profile.id, p_offer_id: id, p_action: action });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }
  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}
