import { apiFailure, publicBusinessError, withApiErrors } from "@/lib/api-route";
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";

async function POSTHandler(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "cart-checkout", String(profile.id), 12, 60))) return NextResponse.json({ error: "Слишком много попыток покупки" }, { status: 429 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });
  const requestKey = request.headers.get("x-idempotency-key")?.trim() || `srv-cart-${crypto.randomUUID()}`;
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(requestKey)) return NextResponse.json({ error: "Некорректный ключ операции" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const cart = await supabase.from("market_cart_items").select("virtual_gift_id").eq("profile_id", profile.id).order("added_at", { ascending: true }).limit(20);
  if (cart.error) return apiFailure(cart.error, "Не удалось выполнить запрос");
  const ids = (cart.data || []).map((row) => String(row.virtual_gift_id));
  if (!ids.length) return NextResponse.json({ error: "Корзина пуста" }, { status: 409 });

  const result = await supabase.rpc("buy_virtual_gift_cart_v2", { p_buyer_id: profile.id, p_virtual_gift_ids: ids, p_request_key: requestKey });
  if (result.error) return NextResponse.json({ error: publicBusinessError(result.error, "Не удалось купить выбранные подарки") }, { status: 409 });
  return NextResponse.json(result.data, { headers: { "cache-control": "no-store" } });
}
export const POST = withApiErrors("app/api/cart/checkout/route.ts:POST", POSTHandler);
