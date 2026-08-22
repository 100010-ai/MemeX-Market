import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapGift } from "@/lib/mappers";
import type { GiftAsset } from "@/lib/types";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";

type CartBody = { virtualGiftId?: string; action?: "add" | "remove" | "clear" };

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const cart = await supabase.from("market_cart_items").select("virtual_gift_id,added_at").eq("profile_id", profile.id).order("added_at", { ascending: false });
  if (cart.error) return apiFailure(cart.error, "Не удалось загрузить корзину");
  const ids = (cart.data || []).map((row) => String(row.virtual_gift_id));
  if (!ids.length) return NextResponse.json({ items: [], total: 0, count: 0 });
  const gifts = await supabase.from("gift_market_overview").select(giftMarketSelect).in("virtual_gift_id", ids).eq("status", "listed").eq("is_burned", false).or(`listing_expires_at.is.null,listing_expires_at.gt.${nowIso}`);
  if (gifts.error) return apiFailure(gifts.error, "Не удалось загрузить Gifts из корзины");
  const byId = new Map(((gifts.data || []) as Record<string, unknown>[]).map((row) => [String(row.virtual_gift_id), mapGift(row)]));
  const items = ids.map((id) => byId.get(id)).filter((gift): gift is GiftAsset => Boolean(gift));
  const stale = ids.filter((id) => !byId.has(id));
  if (stale.length) {
    const staleCleanup = await supabase.from("market_cart_items").delete().eq("profile_id", profile.id).in("virtual_gift_id", stale);
    if (staleCleanup.error) return apiFailure(staleCleanup.error, "Не удалось очистить устаревшие позиции корзины");
  }
  const total = items.reduce((sum, gift) => sum + Number(gift!.listingPrice || 0), 0);
  return NextResponse.json({ items, total, count: items.length });
}

async function POSTHandler(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "cart-mutate", String(profile.id), 90, 60))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const rawBody = await readJsonObject(request);
  if (!rawBody) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const body = rawBody as CartBody;
  const supabase = getSupabaseAdmin();

  if (body.action === "clear") {
    const cleared = await supabase.from("market_cart_items").delete().eq("profile_id", profile.id);
    if (cleared.error) return apiFailure(cleared.error, "Не удалось очистить корзину");
    return NextResponse.json({ ok: true, count: 0 });
  }

  const id = String(body.virtualGiftId || "");
  if (!validUuidLike(id)) return NextResponse.json({ error: "Invalid Gift id" }, { status: 400 });
  if (body.action === "remove") {
    const removed = await supabase.from("market_cart_items").delete().eq("profile_id", profile.id).eq("virtual_gift_id", id);
    if (removed.error) return apiFailure(removed.error, "Не удалось удалить Gift из корзины");
    return NextResponse.json({ ok: true });
  }

  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля Gifts временно отключена" }, { status: 503 });

  const gift = await supabase.from("virtual_gifts").select("id,owner_profile_id,status,listing_price,listing_expires_at").eq("id", id).maybeSingle();
  if (gift.error) return apiFailure(gift.error, "Не удалось проверить Gift");
  if (!gift.data || gift.data.status !== "listed" || gift.data.listing_price == null || (gift.data.listing_expires_at && new Date(gift.data.listing_expires_at).getTime() <= Date.now())) return NextResponse.json({ error: "Gift is no longer listed" }, { status: 409 });
  if (gift.data.owner_profile_id === profile.id) return NextResponse.json({ error: "You already own this Gift" }, { status: 409 });

  const existing = await supabase.from("market_cart_items").select("virtual_gift_id", { count: "exact", head: true }).eq("profile_id", profile.id);
  if (existing.error) return apiFailure(existing.error, "Не удалось проверить корзину");
  if ((existing.count || 0) >= 20) return NextResponse.json({ error: "В корзине может быть максимум 20 подарков" }, { status: 409 });

  const added = await supabase.from("market_cart_items").upsert({ profile_id: profile.id, virtual_gift_id: id }, { onConflict: "profile_id,virtual_gift_id", ignoreDuplicates: true });
  if (added.error) return apiFailure(added.error, "Не удалось добавить Gift в корзину");
  return NextResponse.json({ ok: true });
}
export const GET = withApiErrors("app/api/cart/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/cart/route.ts:POST", POSTHandler);
