import { readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getRuntimeConfig } from "@/lib/runtime-config";

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "bulk-gift-list", String(profile.id), 12, 60))) return NextResponse.json({ error: "Слишком много массовых операций" }, { status: 429 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) return NextResponse.json({ error: "Торговля Gifts временно отключена" }, { status: 503 });

  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const ids = Array.isArray(body.giftIds) ? body.giftIds.map(String) : [];
  const mode = body.mode === "floor" ? "floor" : body.mode === "fixed" ? "fixed" : null;
  const fixedPrice = body.fixedPrice == null || body.fixedPrice === "" ? null : Number(body.fixedPrice);
  const floorOffsetPct = body.floorOffsetPct == null ? -3 : Number(body.floorOffsetPct);
  const durationDays = body.durationDays == null ? 7 : Number(body.durationDays);

  if (!mode) return NextResponse.json({ error: "Не выбран режим цены" }, { status: 400 });
  if (!ids.length || ids.length > 50 || ids.some((id: string) => !validUuidLike(id)) || new Set(ids).size !== ids.length) return NextResponse.json({ error: "Выберите от 1 до 50 уникальных Gifts" }, { status: 400 });
  if (mode === "fixed" && (fixedPrice == null || !Number.isFinite(fixedPrice) || fixedPrice < 0.01 || fixedPrice > 1_000_000_000)) return NextResponse.json({ error: "Некорректная единая цена" }, { status: 400 });
  if (!Number.isFinite(floorOffsetPct) || floorOffsetPct < -90 || floorOffsetPct > 1000) return NextResponse.json({ error: "Отклонение от floor должно быть от -90% до +1000%" }, { status: 400 });
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 30) return NextResponse.json({ error: "Срок листинга должен быть от 1 до 30 дней" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const result = await supabase.rpc("bulk_list_virtual_gifts_v049", {
    p_profile_id: profile.id,
    p_virtual_gift_ids: ids,
    p_mode: mode,
    p_fixed_price: mode === "fixed" ? fixedPrice : null,
    p_floor_offset_bps: Math.round(floorOffsetPct * 100),
    p_duration_days: durationDays,
  });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json({ result: result.data });
}
export const POST = withApiErrors("app/api/portfolio/bulk-list/route.ts:POST", POSTHandler);
