import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "trade-offer-resolve", String(profile.id), 40, 60))) return NextResponse.json({ error: "Слишком много действий" }, { status: 429 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный ID предложения" }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const action = body.action === "accept" || body.action === "decline" || body.action === "cancel" ? body.action : null;
  if (!action) return NextResponse.json({ error: "Некорректное действие" }, { status: 400 });

  const { data, error } = await getSupabaseAdmin().rpc("resolve_gift_trade_offer_v200", {
    p_actor_id: profile.id,
    p_offer_id: id,
    p_action: action,
  });
  if (error) {
    const message = String(error.message || "");
    const conflict = /no longer|expired|ownership|own|insufficient|active/i.test(message);
    return apiFailure(error, "Не удалось обработать обмен", conflict ? 409 : 400);
  }
  return NextResponse.json({ offer: data }, { headers: { "cache-control": "no-store" } });
}

export const POST = withApiErrors("app/api/trade-offers/[id]/route.ts:POST", POSTHandler);
