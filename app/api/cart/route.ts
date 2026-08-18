import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { giftMarketSelect, mapGift } from "@/lib/mappers";
import type { GiftAsset } from "@/lib/types";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";

export const runtime = "nodejs";

type CartBody = { virtualGiftId?: string; action?: "add" | "remove" | "clear" };

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const cart = await supabase.from("market_cart_items").select("virtual_gift_id,added_at").eq("profile_id", profile.id).order("added_at", { ascending: false });
  if (cart.error) return NextResponse.json({ error: cart.error.message }, { status: 500 });
  const ids = (cart.data || []).map((row) => String(row.virtual_gift_id));
  if (!ids.length) return NextResponse.json({ items: [], total: 0, count: 0 });
  const gifts = await supabase.from("gift_market_overview").select(giftMarketSelect).in("virtual_gift_id", ids).eq("status", "listed").eq("is_burned", false);
  if (gifts.error) return NextResponse.json({ error: gifts.error.message }, { status: 500 });
  const byId = new Map((gifts.data || []).map((row: any) => [String(row.virtual_gift_id), mapGift(row)]));
  const items = ids.map((id) => byId.get(id)).filter((gift): gift is GiftAsset => Boolean(gift));
  const stale = ids.filter((id) => !byId.has(id));
  if (stale.length) await supabase.from("market_cart_items").delete().eq("profile_id", profile.id).in("virtual_gift_id", stale);
  const total = items.reduce((sum, gift) => sum + Number(gift!.listingPrice || 0), 0);
  return NextResponse.json({ items, total, count: items.length });
}

export async function POST(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "cart-mutate", String(profile.id), 90, 60))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const body = await request.json().catch(() => ({})) as CartBody;
  const supabase = getSupabaseAdmin();

  if (body.action === "clear") {
    const cleared = await supabase.from("market_cart_items").delete().eq("profile_id", profile.id);
    if (cleared.error) return NextResponse.json({ error: cleared.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: 0 });
  }

  const id = String(body.virtualGiftId || "");
  if (!validUuidLike(id)) return NextResponse.json({ error: "Invalid Gift id" }, { status: 400 });
  if (body.action === "remove") {
    const removed = await supabase.from("market_cart_items").delete().eq("profile_id", profile.id).eq("virtual_gift_id", id);
    if (removed.error) return NextResponse.json({ error: removed.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const gift = await supabase.from("virtual_gifts").select("id,owner_profile_id,status,listing_price").eq("id", id).maybeSingle();
  if (gift.error) return NextResponse.json({ error: gift.error.message }, { status: 500 });
  if (!gift.data || gift.data.status !== "listed" || gift.data.listing_price == null) return NextResponse.json({ error: "Gift is no longer listed" }, { status: 409 });
  if (gift.data.owner_profile_id === profile.id) return NextResponse.json({ error: "You already own this Gift" }, { status: 409 });

  const existing = await supabase.from("market_cart_items").select("virtual_gift_id", { count: "exact", head: true }).eq("profile_id", profile.id);
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
  if ((existing.count || 0) >= 20) return NextResponse.json({ error: "В корзине может быть максимум 20 подарков" }, { status: 409 });

  const added = await supabase.from("market_cart_items").upsert({ profile_id: profile.id, virtual_gift_id: id }, { onConflict: "profile_id,virtual_gift_id", ignoreDuplicates: true });
  if (added.error) return NextResponse.json({ error: added.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
