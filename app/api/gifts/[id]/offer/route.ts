import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { parseEconomyAmount } from "@/lib/economy";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "gift-offer", String(profile.id), 35, 60))) return NextResponse.json({ error: "Слишком много запросов. Подождите немного." }, { status: 429 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный ID подарка" }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const amount = parseEconomyAmount(body.amount);
  const hasDuration = body.durationHours !== null && body.durationHours !== "" && body.durationHours !== undefined;
  const durationHours = hasDuration ? parseEconomyAmount(body.durationHours) : null;
  if (amount == null || amount <= 0 || amount > 1_000_000_000) return NextResponse.json({ error: "Некорректная сумма предложения" }, { status: 400 });
  if (hasDuration && (durationHours == null || !Number.isInteger(durationHours) || durationHours < 1 || durationHours > 168)) return NextResponse.json({ error: "Срок предложения должен быть от 1 до 168 часов" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("create_gift_offer_v2", { p_buyer_id: profile.id, p_virtual_gift_id: id, p_amount: amount, p_duration_hours: durationHours });
  if (error) return apiFailure(error, "Не удалось создать предложение", 400);
  return NextResponse.json({ offer: data });
}
export const POST = withApiErrors("app/api/gifts/[id]/offer/route.ts:POST", POSTHandler);
