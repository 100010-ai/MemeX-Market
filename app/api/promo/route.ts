import { readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "promo-code", String(profile.id), 12, 300))) return NextResponse.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const code = String(body.code || "").trim().toUpperCase().slice(0, 32);
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return NextResponse.json({ error: "Некорректный промокод" }, { status: 400 });
  const result = await getSupabaseAdmin().rpc("redeem_promo_code_v047", { p_profile_id: profile.id, p_code: code });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json({ ok: true, result: result.data });
}
export const POST = withApiErrors("app/api/promo/route.ts:POST", POSTHandler);
