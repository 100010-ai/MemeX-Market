import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";


async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "mxm-store", String(profile.id), 20, 60))) {
    return NextResponse.json({ error: "Слишком много покупок. Подождите минуту." }, { status: 429 });
  }

  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const sku = typeof body.sku === "string" ? body.sku.trim().toLowerCase() : "";
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  if (!/^[a-z0-9_]{3,48}$/.test(sku)) return NextResponse.json({ error: "Некорректный товар" }, { status: 400 });
  if (!validUuidLike(requestId)) return NextResponse.json({ error: "Некорректный идентификатор покупки" }, { status: 400 });

  const { data, error } = await getSupabaseAdmin().rpc("purchase_with_mxm_v200", {
    p_request_id: requestId,
    p_profile_id: profile.id,
    p_sku: sku,
  });
  if (error) {
    console.error("mxm store purchase", error);
    const message = error.message || "";
    const insufficient = /insufficient mxm/i.test(message);
    const soldOut = /sold out/i.test(message);
    const eligibilityReason = /not eligible:\s*([a-z0-9_]+)/i.exec(message)?.[1] || null;
    const eligibilityMessages: Record<string, string> = {
      case_sold_out: "Этот кейс распродан",
      case_config_invalid: "Кейс временно недоступен: таблица наград обновляется",
      profile_item_owned: "Этот предмет профиля уже получен",
      energy_full: "Энергия уже заполнена",
      active_purchase_reservation: "Предыдущая покупка этого товара ещё подтверждается",
    };
    if (insufficient) return NextResponse.json({ error: "Недостаточно MXM" }, { status: 409 });
    if (soldOut) return NextResponse.json({ error: "Товар распродан" }, { status: 409 });
    if (eligibilityReason) return NextResponse.json({ error: eligibilityMessages[eligibilityReason] || "Покупка сейчас недоступна", reason: eligibilityReason }, { status: 409 });
    if (/unavailable|already used/i.test(message)) return NextResponse.json({ error: "Покупка сейчас недоступна" }, { status: 409 });
    return apiFailure(error, "Не удалось выполнить покупку", 400);
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
export const POST = withApiErrors("app/api/store/mxm/route.ts:POST", POSTHandler);
