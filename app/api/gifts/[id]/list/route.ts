import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "gift-list", String(profile.id), 45, 60))) return NextResponse.json({ error: "Слишком много запросов. Подождите немного." }, { status: 429 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const price = body.price === null || body.price === "" || body.price === undefined ? null : Number(body.price);
  if (price !== null && (!Number.isFinite(price) || price <= 0)) return NextResponse.json({ error: "Некорректная цена лота" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("list_virtual_gift", { p_profile_id: profile.id, p_virtual_gift_id: id, p_price: price });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ listing: data });
}
