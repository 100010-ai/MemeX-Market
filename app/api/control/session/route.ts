import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import {
  browserControlConfigured,
  clearLocalControlSession,
  createLocalControlSession,
  ensureLocalControlKey,
  getControlSession,
  localControlAvailable,
  requestControlLoginCode,
  verifyControlLoginCode,
  verifyLocalToken,
} from "@/lib/local-admin";
import { sameOriginMutation } from "@/lib/security";
import { getSupabaseAdminConfigStatus } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function GETHandler(request: Request) {
  const available = localControlAvailable(request);
  if (available && process.env.NODE_ENV !== "production" && !browserControlConfigured()) ensureLocalControlKey();
  const session = available ? await getControlSession(request) : null;
  return NextResponse.json({
    available,
    authenticated: Boolean(session),
    authMode: browserControlConfigured() ? "telegram_otp" : "local_token",
    adminTelegramId: session?.mode === "telegram" ? session.telegramId : null,
    supabase: available ? getSupabaseAdminConfigStatus() : undefined,
  });
}

async function POSTHandler(request: Request) {
  if (!localControlAvailable(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });

  try {
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "request_code") {
      const result = await requestControlLoginCode(body.telegramId);
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "verify_code") {
      const telegramId = String(body.telegramId || "").trim();
      const valid = await verifyControlLoginCode(telegramId, body.code);
      if (!valid) return NextResponse.json({ error: "Неверный или просроченный код" }, { status: 401 });
      await createLocalControlSession(telegramId);
      return NextResponse.json({ ok: true, authenticated: true, adminTelegramId: telegramId });
    }

    if (process.env.NODE_ENV !== "production" && typeof body.token === "string") {
      if (!verifyLocalToken(body.token)) return NextResponse.json({ error: "Неверный локальный ключ" }, { status: 401 });
      await createLocalControlSession("local");
      return NextResponse.json({ ok: true, authenticated: true });
    }

    return NextResponse.json({ error: "Неизвестный способ входа" }, { status: 400 });
  } catch (error) {
    return apiFailure(error, "Не удалось выполнить вход в Control Center", 400);
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
