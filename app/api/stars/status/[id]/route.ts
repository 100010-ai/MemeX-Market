import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { validUuidLike } from "@/lib/security";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректная покупка" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("star_purchases").select("id,stars,ton_reward,status,paid_at,created_at").eq("id", id).eq("profile_id", profile.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Не удалось проверить оплату" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Покупка не найдена" }, { status: 404 });
  return NextResponse.json({ purchase: { id: data.id, stars: Number(data.stars), virtualTon: Number(data.ton_reward), status: data.status, paidAt: data.paid_at, createdAt: data.created_at } }, { headers: { "cache-control": "private, no-store" } });
}
