import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function missing(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (error.code === "42883" || /case_snapshot_v200|open_case_v200|schema cache|could not find the function/i.test(error.message || "")));
}

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("case_snapshot_v200", { p_profile_id: profile.id });
  if (error) return NextResponse.json({ error: missing(error) ? "Примените миграцию экономики Market 2.0" : "Не удалось загрузить кейсы" }, { status: missing(error) ? 503 : 500 });
  return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "case-open", String(profile.id), 20, 60))) return NextResponse.json({ error: "Слишком много открытий. Подождите минуту." }, { status: 429 });
  const body = await request.json().catch(() => ({}));
  const caseSku = typeof body.caseSku === "string" ? body.caseSku.trim().toLowerCase() : "";
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  if (!/^[a-z0-9_]{3,48}$/.test(caseSku)) return NextResponse.json({ error: "Некорректный кейс" }, { status: 400 });
  if (!validUuidLike(requestId)) return NextResponse.json({ error: "Некорректный идентификатор открытия" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().rpc("open_case_v200", { p_profile_id: profile.id, p_case_sku: caseSku, p_request_id: requestId });
  if (error) {
    console.error("case open", error);
    const empty = /inventory|no case|case.*empty/i.test(error.message || "");
    const unavailable = /not found|inactive|no active loot/i.test(error.message || "");
    return NextResponse.json({ error: missing(error) ? "Примените миграцию экономики Market 2.0" : empty ? "В инвентаре нет этого кейса" : unavailable ? "Кейс временно недоступен" : "Не удалось открыть кейс" }, { status: missing(error) ? 503 : empty ? 409 : unavailable ? 404 : 400 });
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
export const GET = withApiErrors("app/api/cases/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/cases/route.ts:POST", POSTHandler);
