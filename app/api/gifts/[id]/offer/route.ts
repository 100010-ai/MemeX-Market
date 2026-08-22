import { readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "gift-offer", String(profile.id), 35, 60))) return NextResponse.json({ error: "Слишком много запросов. Подождите немного." }, { status: 429 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });
  const { id } = await params;
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const amount = Number(body.amount);
  const durationHours = body.durationHours == null ? null : Number(body.durationHours);
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Некорректная сумма предложения" }, { status: 400 });
  if (durationHours !== null && (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 168)) return NextResponse.json({ error: "Срок предложения должен быть от 1 до 168 часов" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("create_gift_offer_v2", { p_buyer_id: profile.id, p_virtual_gift_id: id, p_amount: amount, p_duration_hours: durationHours });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ offer: data });
}
export const POST = withApiErrors("app/api/gifts/[id]/offer/route.ts:POST", POSTHandler);
