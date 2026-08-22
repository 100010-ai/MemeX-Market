import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";

function migrationMissing(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (error.code === "42883" || /purchase_with_mxm_v200|schema cache|could not find the function/i.test(error.message || "")));
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "mxm-store", String(profile.id), 20, 60))) {
    return NextResponse.json({ error: "Слишком много покупок. Подождите минуту." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
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
    const insufficient = /insufficient mxm/i.test(error.message || "");
    const soldOut = /sold out/i.test(error.message || "");
    const unavailable = /not eligible|unavailable|already used/i.test(error.message || "");
    return NextResponse.json({ error: migrationMissing(error) ? "Примените миграцию экономики Market 2.0" : insufficient ? "Недостаточно MXM Coins" : soldOut ? "Товар распродан" : unavailable ? "Покупка сейчас недоступна" : "Не удалось выполнить покупку" }, { status: migrationMissing(error) ? 503 : insufficient || soldOut || unavailable ? 409 : 400 });
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
export const POST = withApiErrors("app/api/store/mxm/route.ts:POST", POSTHandler);
