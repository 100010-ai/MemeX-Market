import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { getSessionProfileSnapshot } from "@/lib/auth";
import { getSessionConfigStatus } from "@/lib/session";
import { auditMainChannelRewardIfNeeded } from "@/lib/telegram-membership";

async function GETHandler(_request: Request) {
  if (!getSessionConfigStatus().configured) return NextResponse.json({ error: "Сессии временно недоступны" }, { status: 503 });
  try {
    // Account-switch validation is handled by requireSession() using the
    // x-mxm-telegram-id request header. Keep GET /api/me side-effect free with
    // respect to query parameters so a cross-site navigation cannot clear a
    // valid Telegram session by supplying an arbitrary expected ID.
    let profile = await getSessionProfileSnapshot();
    if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
    try {
      const audit = await auditMainChannelRewardIfNeeded(profile);
      // A clawback changes balance. Refresh the snapshot so the client never
      // sees the pre-revocation balance from the same /api/me request.
      if (audit?.revokedAt) profile = await getSessionProfileSnapshot() || profile;
    } catch (auditError) {
      // Telegram availability must not make /api/me fail. Claim itself still
      // requires a successful, fresh getChatMember verification.
      console.warn("main channel reward audit skipped", auditError);
    }
    return NextResponse.json({ profile }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("me", error);
    return apiFailure(error, "Не удалось загрузить профиль");
  }
}
export const GET = withApiErrors("app/api/me/route.ts:GET", GETHandler);
