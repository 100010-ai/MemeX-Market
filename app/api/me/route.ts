import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { getSessionProfileSnapshot } from "@/lib/auth";
import { clearSession, getSessionConfigStatus, readSession } from "@/lib/session";
import { auditMainChannelRewardIfNeeded } from "@/lib/telegram-membership";

async function GETHandler(request: NextRequest) {
  const expectedRaw = request.nextUrl.searchParams.get("expectedTelegramId");
  const expectedTelegramId = expectedRaw == null ? null : Number(expectedRaw);
  if (expectedRaw != null && (!Number.isSafeInteger(expectedTelegramId) || Number(expectedTelegramId) <= 0)) {
    return NextResponse.json({ error: "Некорректный Telegram ID", code: "INVALID_TELEGRAM_ID" }, { status: 400 });
  }
  if (!getSessionConfigStatus().configured) return NextResponse.json({ error: "Сессии временно недоступны" }, { status: 503 });
  try {
    const session = await readSession();
    if (!session) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
    if (expectedTelegramId != null && session.telegramId !== expectedTelegramId) {
      // Telegram Desktop may reuse this origin across Telegram accounts. Remove
      // the stale cookie immediately so no later request can observe account A
      // while account B is active.
      await clearSession();
      return NextResponse.json({ error: "Аккаунт Telegram изменился", code: "SESSION_ACCOUNT_MISMATCH" }, { status: 409, headers: { "cache-control": "private, no-store" } });
    }
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
