import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { clearLocalControlSession, consumeLocalControlLoginAttempt, createLocalControlSession, ensureLocalControlKey, hasLocalControlSession, localControlAvailable, verifyLocalToken } from "@/lib/local-admin";
import { sameOriginMutation } from "@/lib/security";
import { getSupabaseAdminConfigStatus } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function GETHandler(request: Request) {
  const available = localControlAvailable(request);
  if (available) ensureLocalControlKey();
  return NextResponse.json({
    available,
    authenticated: available ? await hasLocalControlSession(request) : false,
    supabase: available ? getSupabaseAdminConfigStatus() : undefined,
  });
}

async function POSTHandler(request: Request) {
  if (!localControlAvailable(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!consumeLocalControlLoginAttempt("localhost")) return NextResponse.json({ error: "Слишком много попыток входа." }, { status: 429 });
  const body = await request.json().catch(() => ({}));
  const input = typeof body.token === "string" ? body.token : "";
  try {
    if (!verifyLocalToken(input)) return NextResponse.json({ error: "Неверный локальный ключ" }, { status: 401 });
    await createLocalControlSession();
    const supabase = getSupabaseAdminConfigStatus();
    return NextResponse.json({ ok: true, supabase });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Локальная админка не настроена" }, { status: 500 });
  }
}

async function DELETEHandler(request: Request) {
  if (!localControlAvailable(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  await clearLocalControlSession();
  return NextResponse.json({ ok: true });
}
export const GET = withApiErrors("app/api/control/session/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/control/session/route.ts:POST", POSTHandler);
export const DELETE = withApiErrors("app/api/control/session/route.ts:DELETE", DELETEHandler);
