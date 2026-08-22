import { readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { recordAppError } from "@/lib/error-inbox";

async function GETHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный coin ID" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("coin_conditional_orders_v056")
    .select("id,kind,trigger_price,input_amount,status,expires_at,result,failure_reason,created_at,executed_at")
    .eq("profile_id", profile.id).eq("coin_id", id)
    .order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: (data || []).map((row) => ({
    id: String(row.id), kind: String(row.kind), triggerPrice: Number(row.trigger_price), inputAmount: Number(row.input_amount),
    status: String(row.status), expiresAt: String(row.expires_at), result: row.result || null, failureReason: row.failure_reason || null,
    createdAt: String(row.created_at), executedAt: row.executed_at ? String(row.executed_at) : null,
  })) }, { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "coin-conditional-order", String(profile.id), 30, 60))) return NextResponse.json({ error: "Слишком много запросов ордеров" }, { status: 429 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный coin ID" }, { status: 400 });
  try {
    const config = await getRuntimeConfig();
    if (!config.featureFlags.memecoins) return NextResponse.json({ error: "Торговля мемкоинами временно отключена" }, { status: 503 });
    const body = await readJsonObject(request);
    if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    const kind = ["limit_buy", "limit_sell", "take_profit", "stop_loss"].includes(body.kind) ? String(body.kind) : "";
    const triggerPrice = Number(body.triggerPrice);
    const inputAmount = Number(body.inputAmount);
    const requestKey = typeof body.requestKey === "string" ? body.requestKey.trim() : "";
    const durationDays = Math.min(config.remoteConfig.coinOrderMaxDays, Number(body.durationDays ?? 7));
    if (!kind || !Number.isFinite(triggerPrice) || triggerPrice <= 0 || !Number.isFinite(inputAmount) || inputAmount <= 0 || !/^[A-Za-z0-9._:-]{8,120}$/.test(requestKey) || !Number.isInteger(durationDays) || durationDays < 1) {
      return NextResponse.json({ error: "Некорректные параметры ордера" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { count, error: countError } = await supabase.from("coin_conditional_orders_v056").select("id", { count: "exact", head: true }).eq("profile_id", profile.id).eq("status", "active");
    if (countError) throw countError;
    if (Number(count || 0) >= config.remoteConfig.coinOrderMaxOpen) return NextResponse.json({ error: `Лимит активных ордеров: ${config.remoteConfig.coinOrderMaxOpen}` }, { status: 409 });
    const { data, error } = await supabase.rpc("create_coin_conditional_order_v056", {
      p_profile_id: profile.id, p_coin_id: id, p_kind: kind, p_trigger_price: triggerPrice, p_input_amount: inputAmount,
      p_request_key: requestKey, p_duration_days: durationDays,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ order: data }, { status: 201 });
  } catch (error) {
    console.error("create conditional order", error);
    await recordAppError(`/api/coins/${id}/orders`, error, String(profile.id));
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось создать ордер" }, { status: 500 });
  }
}
export const GET = withApiErrors("app/api/coins/[id]/orders/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/coins/[id]/orders/route.ts:POST", POSTHandler);
