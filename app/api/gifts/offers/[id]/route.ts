import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  if (!(await enforceRateLimit(request, "gift-offer-resolve", String(profile.id), 50, 60))) return NextResponse.json({ error: "Слишком много операций. Попробуйте позже." }, { status: 429 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный ID предложения" }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const action = String(body.action || "");
  const supabase = getSupabaseAdmin();
  if (action === "cancel") {
    const { error } = await supabase.rpc("cancel_gift_offer", { p_buyer_id: profile.id, p_offer_id: id });
    if (error) return apiFailure(error, "Не удалось отменить предложение", 400);
    return NextResponse.json({ status: "cancelled" });
  }
  if (action === "accept" || action === "reject") {
    if (action === "accept") {
      const runtimeConfig = await getRuntimeConfig();
      if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });
    }
    const { data, error } = await supabase.rpc("resolve_gift_offer_v2", { p_owner_id: profile.id, p_offer_id: id, p_action: action });
    if (error) return apiFailure(error, action === "accept" ? "Не удалось принять предложение" : "Не удалось отклонить предложение", 400);
    return NextResponse.json(data);
  }
  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}
export const POST = withApiErrors("app/api/gifts/offers/[id]/route.ts:POST", POSTHandler);
