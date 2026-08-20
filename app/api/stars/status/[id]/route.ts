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
  let { data, error } = await supabase.from("star_purchases").select("id,stars,ton_reward,product_sku,status,telegram_payment_charge_id,paid_at,created_at").eq("id", id).eq("profile_id", profile.id).maybeSingle();
  const legacySchema = error && (error.code === "42703" || /product_sku|schema cache|column .* does not exist/i.test(error.message || ""));
  if (legacySchema) {
    const legacy = await supabase.from("star_purchases").select("id,stars,ton_reward,status,telegram_payment_charge_id,paid_at,created_at").eq("id", id).eq("profile_id", profile.id).maybeSingle();
    data = legacy.data ? { ...legacy.data, product_sku: null } : null;
    error = legacy.error;
  }
  if (error) return NextResponse.json({ error: "Не удалось проверить оплату" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Покупка не найдена" }, { status: 404 });
  return NextResponse.json({ purchase: { id: data.id, stars: Number(data.stars), virtualTon: Number(data.ton_reward), productSku: data.product_sku, status: data.status, telegramPaymentChargeId: data.telegram_payment_charge_id, paidAt: data.paid_at, createdAt: data.created_at } }, { headers: { "cache-control": "private, no-store" } });
}
