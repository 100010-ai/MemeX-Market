import { NextResponse } from "next/server";
import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { requireAdminProfile } from "@/lib/admin";
import { configuredOwnerTelegramId, getAdminOwnerConfigStatus, setAdminSession } from "@/lib/admin-session";
import { enforceRateLimit, requestIp, safeSecretEquals, sameOriginMutation, securityKey } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type AuthAuditInput = {
  action: "owner.auth.success" | "owner.auth.failure";
  request: Request;
  profileId?: string;
  reason?: "invalid_key" | "profile_missing" | "profile_banned";
};

function adminPayload(admin: NonNullable<Awaited<ReturnType<typeof requireAdminProfile>>>) {
  return {
    profileId: String(admin.id),
    role: admin.adminRole,
    roleLabel: admin.adminRole === "owner" ? "Владелец" : admin.adminRole === "operator" ? "Оператор" : admin.adminRole === "moderator" ? "Модератор" : "Аналитик",
    source: admin.adminSource,
  };
}

async function auditAuthAttempt({ action, request, profileId, reason }: AuthAuditInput) {
  const ipToken = securityKey("owner-auth-ip", requestIp(request)).slice(0, 16);
  const userAgent = (request.headers.get("user-agent") || "unknown").slice(0, 180);
  const actor = action === "owner.auth.success" ? `admin-owner:${configuredOwnerTelegramId()}` : `owner-auth:${ipToken}`;
  try {
    const result = await getSupabaseAdmin().from("admin_audit_log").insert({
      actor,
      action,
      target_type: "admin_auth",
      target_id: profileId || null,
      payload: { outcome: action.endsWith("success") ? "success" : "failure", reason: reason || null, ipToken, userAgent },
    });
    if (result.error) console.error("owner auth audit", result.error);
  } catch (error) {
    console.error("owner auth audit", error);
  }
}

async function GETHandler() {
  const admin = await requireAdminProfile();
  if (!admin) {
    return NextResponse.json({ authenticated: false, configured: getAdminOwnerConfigStatus().configured }, {
      status: 401,
      headers: { "cache-control": "private, no-store" },
    });
  }
  return NextResponse.json({ authenticated: true, admin: adminPayload(admin) }, {
    headers: { "cache-control": "private, no-store" },
  });
}

async function POSTHandler(request: Request) {
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const config = getAdminOwnerConfigStatus();
  const configuredKey = process.env.ADMIN_OWNER_KEY?.trim() || "";
  const telegramId = configuredOwnerTelegramId();
  if (!config.configured || !telegramId) return NextResponse.json({ error: "Вход владельца не настроен" }, { status: 503 });

  const allowed = await enforceRateLimit(request, "admin-owner-auth", requestIp(request), 8, 15 * 60);
  if (!allowed) return NextResponse.json({ error: "Слишком много попыток. Повторите позже." }, { status: 429, headers: { "retry-after": "900" } });

  const body = await readJsonObject(request);
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!safeSecretEquals(key, configuredKey)) {
    await auditAuthAttempt({ action: "owner.auth.failure", request, reason: "invalid_key" });
    return NextResponse.json({ error: "Неверный ключ доступа" }, { status: 401 });
  }

  const profile = await getSupabaseAdmin().from("profiles")
    .select("id,telegram_id,is_banned,banned_until")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (profile.error) return apiFailure(profile.error, "Не удалось проверить владельца");
  if (!profile.data) {
    await auditAuthAttempt({ action: "owner.auth.failure", request, reason: "profile_missing" });
    return NextResponse.json({ error: "Профиль владельца недоступен" }, { status: 403 });
  }
  const bannedUntil = profile.data.banned_until ? new Date(String(profile.data.banned_until)).getTime() : null;
  if (profile.data.is_banned && (bannedUntil == null || bannedUntil > Date.now())) {
    await auditAuthAttempt({ action: "owner.auth.failure", request, profileId: String(profile.data.id), reason: "profile_banned" });
    return NextResponse.json({ error: "Профиль владельца недоступен" }, { status: 403 });
  }

  await setAdminSession(telegramId);
  await auditAuthAttempt({ action: "owner.auth.success", request, profileId: String(profile.data.id) });
  return NextResponse.json({
    authenticated: true,
    admin: { profileId: String(profile.data.id), role: "owner", roleLabel: "Владелец", source: "key" },
  }, {
    headers: { "cache-control": "private, no-store" },
  });
}

export const GET = withApiErrors("app/api/admin/auth/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/admin/auth/route.ts:POST", POSTHandler);
