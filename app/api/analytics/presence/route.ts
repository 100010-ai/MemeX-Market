import { NextResponse } from "next/server";
import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const SESSION_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "product-presence", String(profile.id), 12, 60))) {
    return NextResponse.json({ error: "Слишком много событий присутствия" }, { status: 429 });
  }

  const body = await readJsonObject(request);
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  const rawRoute = typeof body?.route === "string" ? body.route.trim() : "/market";
  const route = rawRoute.startsWith("/") ? rawRoute.split("?", 1)[0].slice(0, 96) : "/market";
  if (!SESSION_PATTERN.test(sessionId)) return NextResponse.json({ error: "Некорректная сессия присутствия" }, { status: 400 });

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("touch_profile_presence_v067", {
      p_profile_id: profile.id,
      p_session_id: sessionId,
      p_route: route || "/market",
    });
    if (error) throw error;
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error, "Не удалось записать присутствие");
  }
}

export const POST = withApiErrors("app/api/analytics/presence/route.ts:POST", POSTHandler);
