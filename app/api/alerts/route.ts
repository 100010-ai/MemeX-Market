import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";

const kinds = new Set(["coin", "gift", "gift_collection"]);
const directions = new Set(["below", "above"]);

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("price_alerts").select("id,kind,coin_id,virtual_gift_id,gift_collection,direction,target_price,enabled,last_triggered_at,created_at").eq("profile_id", profile.id).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alerts: (data || []).map((row) => ({ id: String(row.id), kind: row.kind, coinId: row.coin_id || null, giftId: row.virtual_gift_id || null, giftCollection: row.gift_collection || null, direction: row.direction, targetPrice: Number(row.target_price), enabled: Boolean(row.enabled), lastTriggeredAt: row.last_triggered_at || null, createdAt: row.created_at })) });
}

export async function POST(request: Request) {
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
  if (kind === "coin") row.coin_id = typeof body.coinId === "string" ? body.coinId : null;
  if (kind === "gift") row.virtual_gift_id = typeof body.giftId === "string" ? body.giftId : null;
  if (kind === "gift_collection") row.gift_collection = typeof body.giftCollection === "string" ? body.giftCollection.trim() : null;
  if ((kind === "coin" && !row.coin_id) || (kind === "gift" && !row.virtual_gift_id) || (kind === "gift_collection" && !row.gift_collection)) return NextResponse.json({ error: "Не выбран объект алерта" }, { status: 400 });
  const { data, error } = await supabase.from("price_alerts").insert(row).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
