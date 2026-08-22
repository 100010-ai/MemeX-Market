import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";

const kinds = new Set(["coin", "gift", "gift_collection"]);
const directions = new Set(["below", "above"]);

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("price_alerts").select("id,kind,coin_id,virtual_gift_id,gift_collection,direction,target_price,enabled,last_triggered_at,created_at").eq("profile_id", profile.id).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alerts: (data || []).map((row) => ({ id: String(row.id), kind: row.kind, coinId: row.coin_id || null, giftId: row.virtual_gift_id || null, giftCollection: row.gift_collection || null, direction: row.direction, targetPrice: Number(row.target_price), enabled: Boolean(row.enabled), lastTriggeredAt: row.last_triggered_at || null, createdAt: row.created_at })) });
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "price-alert", String(profile.id), 40, 60))) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 });
  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "create";
  const supabase = getSupabaseAdmin();

  if (action === "delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный ID алерта" }, { status: 400 });
    const { error } = await supabase.from("price_alerts").delete().eq("id", id).eq("profile_id", profile.id);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }

  if (action === "toggle") {
    const id = typeof body.id === "string" ? body.id : "";
    const enabled = body.enabled === true;
    if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный ID алерта" }, { status: 400 });
    const { error } = await supabase.from("price_alerts").update({ enabled, updated_at: new Date().toISOString() }).eq("id", id).eq("profile_id", profile.id);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true, enabled });
  }

  const kind = typeof body.kind === "string" && kinds.has(body.kind) ? body.kind : null;
  const direction = typeof body.direction === "string" && directions.has(body.direction) ? body.direction : null;
  const targetPrice = Number(body.targetPrice);
  if (!kind || !direction || !Number.isFinite(targetPrice) || targetPrice <= 0) return NextResponse.json({ error: "Некорректный алерт" }, { status: 400 });

  const row: Record<string, unknown> = { profile_id: profile.id, kind, direction, target_price: targetPrice, enabled: true };
  if (kind === "coin") row.coin_id = typeof body.coinId === "string" && validUuidLike(body.coinId) ? body.coinId : null;
  if (kind === "gift") row.virtual_gift_id = typeof body.giftId === "string" && validUuidLike(body.giftId) ? body.giftId : null;
  if (kind === "gift_collection") row.gift_collection = typeof body.giftCollection === "string" ? body.giftCollection.trim() : null;
  if ((kind === "coin" && !row.coin_id) || (kind === "gift" && !row.virtual_gift_id) || (kind === "gift_collection" && !row.gift_collection)) return NextResponse.json({ error: "Не выбран объект алерта" }, { status: 400 });

  // Reject alerts for stale/non-existent objects before consuming a slot.
  if (kind === "coin") {
    const { data: coin, error } = await supabase.from("coins").select("id").eq("id", String(row.coin_id)).eq("status", "active").maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!coin) return NextResponse.json({ error: "Мемкоин не найден" }, { status: 404 });
  } else if (kind === "gift") {
    const { data: gift, error } = await supabase.from("virtual_gifts").select("id").eq("id", String(row.virtual_gift_id)).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!gift) return NextResponse.json({ error: "Gift не найден" }, { status: 404 });
  } else {
    const { data: collection, error } = await supabase.from("gift_collection_overview").select("base_name").eq("base_name", String(row.gift_collection)).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!collection) return NextResponse.json({ error: "Коллекция не найдена" }, { status: 404 });
  }

  // Creating the same alert twice is idempotent and must not consume the limit.
  let duplicateQuery = supabase
    .from("price_alerts")
    .select("id,enabled")
    .eq("profile_id", profile.id)
    .eq("kind", kind)
    .eq("direction", direction)
    .eq("target_price", targetPrice);
  if (kind === "coin") duplicateQuery = duplicateQuery.eq("coin_id", String(row.coin_id));
  if (kind === "gift") duplicateQuery = duplicateQuery.eq("virtual_gift_id", String(row.virtual_gift_id));
  if (kind === "gift_collection") duplicateQuery = duplicateQuery.eq("gift_collection", String(row.gift_collection));
  const { data: duplicate, error: duplicateError } = await duplicateQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (duplicateError) return NextResponse.json({ error: duplicateError.message }, { status: 500 });
  if (duplicate) {
    if (!duplicate.enabled) {
      const { error } = await supabase.from("price_alerts").update({ enabled: true, updated_at: new Date().toISOString() }).eq("id", duplicate.id).eq("profile_id", profile.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ id: duplicate.id, existing: true });
  }

  const [config, alertCount] = await Promise.all([
    getRuntimeConfig(),
    supabase.from("price_alerts").select("id", { count: "exact", head: true }).eq("profile_id", profile.id).eq("enabled", true),
  ]);
  if (alertCount.error) return NextResponse.json({ error: alertCount.error.message }, { status: 500 });
  if (Number(alertCount.count || 0) >= config.remoteConfig.maxPriceAlerts) return NextResponse.json({ error: `Лимит активных алертов: ${config.remoteConfig.maxPriceAlerts}` }, { status: 409 });

  const { data, error } = await supabase.from("price_alerts").insert(row).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
export const GET = withApiErrors("app/api/alerts/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/alerts/route.ts:POST", POSTHandler);
