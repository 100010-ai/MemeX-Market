import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "gift-buy", String(profile.id), 30, 60))) return NextResponse.json({ error: "Слишком много запросов. Подождите немного." }, { status: 429 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля Gifts временно отключена" }, { status: 503 });
  const { id } = await params;
  const requestKey = request.headers.get("x-idempotency-key")?.trim() || `srv-${crypto.randomUUID()}`;
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(requestKey)) return NextResponse.json({ error: "Некорректный ключ операции" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("buy_virtual_gift_v2", { p_buyer_id: profile.id, p_virtual_gift_id: id, p_request_key: requestKey });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await supabase.from("market_cart_items").delete().eq("profile_id", profile.id).eq("virtual_gift_id", id);
  return NextResponse.json({ trade: data }, { headers: { "cache-control": "no-store" } });
}
