import { apiFailure, withApiErrors } from "@/lib/api-route";
import crypto from "node:crypto";
import { after, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { evaluatePlayerMarketHandoff, getGiftMarketLiquidityState } from "@/lib/npc-market";

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "gift-buy", String(profile.id), 30, 60))) return NextResponse.json({ error: "Слишком много запросов. Подождите немного." }, { status: 429 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный ID подарка" }, { status: 400 });
  const requestKey = request.headers.get("x-idempotency-key")?.trim() || `srv-${crypto.randomUUID()}`;
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(requestKey)) return NextResponse.json({ error: "Некорректный ключ операции" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const liquidity = await getGiftMarketLiquidityState();
  if (liquidity.playerOnly) {
    const ownerResult = await supabase.from("virtual_gifts").select("owner_profile_id").eq("id", id).maybeSingle();
    if (ownerResult.error) return apiFailure(ownerResult.error, "Не удалось проверить продавца подарка");
    if (ownerResult.data?.owner_profile_id) {
      const ownerProfile = await supabase.from("profiles").select("is_system").eq("id", ownerResult.data.owner_profile_id).maybeSingle();
      if (ownerProfile.error) return apiFailure(ownerProfile.error, "Не удалось проверить продавца подарка");
      if (ownerProfile.data?.is_system) return NextResponse.json({ error: "Стартовая ликвидность отключена. Этот системный подарок больше недоступен для покупки." }, { status: 409 });
    }
  }
  const { data, error } = await supabase.rpc("buy_virtual_gift_v2", { p_buyer_id: profile.id, p_virtual_gift_id: id, p_request_key: requestKey });
  if (error) return apiFailure(error, "Не удалось купить подарок", 400);
  const profileId = String(profile.id);
  after(async () => {
    try {
      const cartCleanup = await getSupabaseAdmin().from("market_cart_items").delete().eq("profile_id", profileId).eq("virtual_gift_id", id);
      if (cartCleanup.error) console.error("gift buy cart cleanup", cartCleanup.error);
    } catch (cause) { console.error("gift buy cart cleanup", cause); }
    await evaluatePlayerMarketHandoff(false).catch((cause) => console.error("gift market handoff after buy", cause));
  });
  return NextResponse.json({ trade: data }, { headers: { "cache-control": "no-store" } });
}
export const POST = withApiErrors("app/api/gifts/[id]/buy/route.ts:POST", POSTHandler);
