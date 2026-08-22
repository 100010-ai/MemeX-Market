import { apiFailure, publicBusinessError, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sameOriginMutation, validUuidLike } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный ID предложения" }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const action = body.action === "cancel" ? "cancel" : body.action === "accept" ? "accept" : null;
  if (!action) return NextResponse.json({ error: "Некорректное действие" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  if (action === "cancel") {
    const { data, error } = await supabase.rpc("cancel_advanced_gift_offer_v056", { p_buyer_id: profile.id, p_offer_id: id });
    if (error) return NextResponse.json({ error: publicBusinessError(error, "Не удалось отменить предложение") }, { status: 400 });
    return NextResponse.json({ result: data });
  }
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });
  const virtualGiftId = typeof body.virtualGiftId === "string" ? body.virtualGiftId : "";
  if (!validUuidLike(virtualGiftId)) return NextResponse.json({ error: "Выберите подарок для принятия предложения" }, { status: 400 });
  const { data, error } = await supabase.rpc("accept_advanced_gift_offer_v056", { p_owner_id: profile.id, p_virtual_gift_id: virtualGiftId, p_offer_id: id });
  if (error) return NextResponse.json({ error: publicBusinessError(error, "Не удалось принять предложение") }, { status: 400 });
  return NextResponse.json({ result: data });
}
export const POST = withApiErrors("app/api/market/offers/[id]/route.ts:POST", POSTHandler);
