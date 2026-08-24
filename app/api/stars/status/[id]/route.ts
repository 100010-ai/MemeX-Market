import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { validUuidLike } from "@/lib/security";

async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректная покупка" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("star_purchases").select("id,stars,ton_reward,product_sku,status,telegram_payment_charge_id,paid_at,created_at,expires_at").eq("id", id).eq("profile_id", profile.id).maybeSingle();
  if (error) return apiFailure(error, "Не удалось проверить оплату");
  if (!data) return NextResponse.json({ error: "Покупка не найдена" }, { status: 404 });

  const expiresAt = typeof data.expires_at === "string" && Number.isFinite(Date.parse(data.expires_at))
    ? new Date(data.expires_at).toISOString()
    : null;
  const storedStatus = typeof data.status === "string" ? data.status : "pending";
  // A pending Telegram invoice has a finite checkout lifetime even if Telegram
  // never emits an explicit cancellation update. Report that state truthfully
  // without mutating payment rows from a GET request.
  const effectiveStatus = storedStatus === "pending" && expiresAt && Date.parse(expiresAt) <= Date.now()
    ? "expired"
    : storedStatus;

  return NextResponse.json({
    purchase: {
      id: data.id,
      stars: Number(data.stars),
      virtualTon: Number(data.ton_reward),
      productSku: data.product_sku,
      status: effectiveStatus,
      telegramPaymentChargeId: data.telegram_payment_charge_id,
      paidAt: data.paid_at,
      createdAt: data.created_at,
      expiresAt,
    },
  }, { headers: { "cache-control": "private, no-store" } });
}
export const GET = withApiErrors("app/api/stars/status/[id]/route.ts:GET", GETHandler);
