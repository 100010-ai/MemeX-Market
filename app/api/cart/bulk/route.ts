import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { getGiftMarketLiquidityState } from "@/lib/npc-market";
import { getCleanMarketCartIds, MARKET_CART_LIMIT } from "@/lib/cart-state";

export const runtime = "nodejs";
type Body = { virtualGiftIds?: unknown };
async function POSTHandler(request: NextRequest) {
  const profile = await requireProfile(); if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "cart-bulk", String(profile.id), 30, 60))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const body = await readJsonObject(request) as Body | null; if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const rawIds = Array.isArray(body.virtualGiftIds) ? body.virtualGiftIds.map((value) => typeof value === "string" ? value.trim() : "") : [];
  if (!rawIds.length || rawIds.length > 5 || rawIds.some((id) => !validUuidLike(id)) || new Set(rawIds).size !== rawIds.length) return NextResponse.json({ error: "Выберите от 1 до 5 уникальных подарков" }, { status: 400 });
  const ids = rawIds;
  const runtimeConfig = await getRuntimeConfig(); if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });
  const supabase = getSupabaseAdmin();
  try {
    const [gifts, liquidity] = await Promise.all([
      supabase.from("virtual_gifts").select("id,owner_profile_id,status,listing_price,listing_expires_at").in("id", ids),
      getGiftMarketLiquidityState(),
    ]);
    if (gifts.error) throw gifts.error;

    const cartState = await getCleanMarketCartIds(String(profile.id), { playerOnly: liquidity.playerOnly });
    const rows = gifts.data || []; const ownerIds = [...new Set(rows.map((row) => String(row.owner_profile_id)).filter(Boolean))]; const systemOwners = new Set<string>();
    if (liquidity.playerOnly && ownerIds.length) { const owners = await supabase.from("profiles").select("id,is_system").in("id", ownerIds); if (owners.error) throw owners.error; for (const owner of owners.data || []) if (owner.is_system) systemOwners.add(String(owner.id)); }
    const now = Date.now();
    const valid = rows.filter((row) => ids.includes(String(row.id)) && row.owner_profile_id !== profile.id && row.status === "listed" && row.listing_price != null && (!row.listing_expires_at || new Date(row.listing_expires_at).getTime() > now) && (!liquidity.playerOnly || !systemOwners.has(String(row.owner_profile_id)))).map((row) => String(row.id));
    if (!valid.length) return NextResponse.json({ error: "Выбранные лоты уже недоступны" }, { status: 409 });
    const existingIds = new Set(cartState.ids);
    const unavailable = ids.filter((id) => !valid.includes(id)); const alreadyInCart = ids.filter((id) => existingIds.has(id)); const capacity = Math.max(0, MARKET_CART_LIMIT - existingIds.size); const addIds = valid.filter((id) => !existingIds.has(id)).slice(0, capacity);
    if (!addIds.length) { if (capacity <= 0) return NextResponse.json({ error: `В корзине может быть максимум ${MARKET_CART_LIMIT} подарков` }, { status: 409 }); return NextResponse.json({ ok: true, added: [], unavailable, alreadyInCart, count: existingIds.size }); }
    const added = await supabase.from("market_cart_items").upsert(addIds.map((virtualGiftId) => ({ profile_id: profile.id, virtual_gift_id: virtualGiftId })), { onConflict: "profile_id,virtual_gift_id", ignoreDuplicates: true }); if (added.error) throw added.error;
    return NextResponse.json({ ok: true, added: addIds, unavailable, alreadyInCart, count: existingIds.size + addIds.length });
  } catch (error) { return apiFailure(error, "Не удалось добавить набор подарков в корзину"); }
}
export const POST = withApiErrors("app/api/cart/bulk/route.ts:POST", POSTHandler);
