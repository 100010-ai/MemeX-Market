import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapGift } from "@/lib/mappers";
import type { GiftAsset } from "@/lib/types";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { getGiftMarketLiquidityState } from "@/lib/npc-market";
import { getCleanMarketCartIds, MARKET_CART_LIMIT } from "@/lib/cart-state";

export const runtime = "nodejs";

type CartBody = { virtualGiftId?: string; action?: "add" | "remove" | "clear" };

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  try {
    const liquidity = await getGiftMarketLiquidityState();
    const cartState = await getCleanMarketCartIds(String(profile.id), { playerOnly: liquidity.playerOnly });
    const ids = [...cartState.ids].reverse();
    if (!ids.length) return NextResponse.json({ items: [], total: 0, count: 0 });

    const nowIso = new Date().toISOString();
    const gifts = await supabase
      .from("gift_market_overview")
      .select(giftMarketSelect)
      .in("virtual_gift_id", ids)
      .eq("status", "listed")
      .eq("is_burned", false)
      .not("listing_price", "is", null)
      .or(`listing_expires_at.is.null,listing_expires_at.gt.${nowIso}`);
    if (gifts.error) throw gifts.error;

    const byId = new Map(((gifts.data || []) as Record<string, unknown>[]).map((row) => [String(row.virtual_gift_id), mapGift(row)]));
    const items = ids.map((id) => byId.get(id)).filter((gift): gift is GiftAsset => Boolean(gift));
    const total = items.reduce((sum, gift) => sum + Number(gift.listingPrice || 0), 0);
    return NextResponse.json({ items, total, count: items.length });
  } catch (error) {
    return apiFailure(error, "Не удалось загрузить корзину");
  }
}

async function POSTHandler(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "cart-mutate", String(profile.id), 90, 60))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const rawBody = await readJsonObject(request);
  if (!rawBody) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const body = rawBody as CartBody;
  const action = body.action;
  if (action !== "add" && action !== "remove" && action !== "clear") {
    return NextResponse.json({ error: "Некорректное действие с корзиной" }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();

  if (action === "clear") {
    const cleared = await supabase.from("market_cart_items").delete().eq("profile_id", profile.id);
    if (cleared.error) return apiFailure(cleared.error, "Не удалось очистить корзину");
    return NextResponse.json({ ok: true, count: 0 });
  }

  const id = String(body.virtualGiftId || "");
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный идентификатор подарка" }, { status: 400 });
  if (action === "remove") {
    const removed = await supabase.from("market_cart_items").delete().eq("profile_id", profile.id).eq("virtual_gift_id", id);
    if (removed.error) return apiFailure(removed.error, "Не удалось удалить подарок из корзины");
    return NextResponse.json({ ok: true });
  }

  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });

  const gift = await supabase.from("virtual_gifts").select("id,owner_profile_id,status,listing_price,listing_expires_at").eq("id", id).maybeSingle();
  if (gift.error) return apiFailure(gift.error, "Не удалось проверить подарок");
  const liquidity = await getGiftMarketLiquidityState();
  if (liquidity.playerOnly && gift.data?.owner_profile_id) {
    const owner = await supabase.from("profiles").select("is_system").eq("id", gift.data.owner_profile_id).maybeSingle();
    if (owner.error) return apiFailure(owner.error, "Не удалось проверить продавца подарка");
    if (owner.data?.is_system) return NextResponse.json({ error: "Стартовая ликвидность отключена. Этот подарок больше не продаётся на рынке игроков." }, { status: 409 });
  }
  if (!gift.data || gift.data.status !== "listed" || gift.data.listing_price == null || (gift.data.listing_expires_at && new Date(gift.data.listing_expires_at).getTime() <= Date.now())) return NextResponse.json({ error: "Подарок больше не выставлен на продажу" }, { status: 409 });
  if (gift.data.owner_profile_id === profile.id) return NextResponse.json({ error: "Этот подарок уже принадлежит вам" }, { status: 409 });

  try {
    const cartState = await getCleanMarketCartIds(String(profile.id), { playerOnly: liquidity.playerOnly });
    if (cartState.ids.includes(id)) return NextResponse.json({ ok: true, alreadyInCart: true, count: cartState.ids.length });
    if (cartState.ids.length >= MARKET_CART_LIMIT) return NextResponse.json({ error: `В корзине может быть максимум ${MARKET_CART_LIMIT} подарков` }, { status: 409 });

    const added = await supabase.from("market_cart_items").upsert({ profile_id: profile.id, virtual_gift_id: id }, { onConflict: "profile_id,virtual_gift_id", ignoreDuplicates: true });
    if (added.error) throw added.error;
    return NextResponse.json({ ok: true, count: cartState.ids.length + 1 });
  } catch (error) {
    return apiFailure(error, "Не удалось добавить подарок в корзину");
  }
}
export const GET = withApiErrors("app/api/cart/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/cart/route.ts:POST", POSTHandler);
