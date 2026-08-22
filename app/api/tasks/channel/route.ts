import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";
import { MAIN_CHANNEL_URL, verifyMainChannelMembership } from "@/lib/telegram-membership";

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "channel-subscription-check", String(profile.id), 12, 60))) {
    return NextResponse.json({ error: "Слишком много проверок. Подождите немного." }, { status: 429 });
  }

  try {
    const membership = await verifyMainChannelMembership(profile, { force: true });
    return NextResponse.json({
      ok: true,
      channelUrl: MAIN_CHANNEL_URL,
      ...membership,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("channel subscription verification", error);
    return apiFailure(error, "Не удалось проверить подписку через Telegram", 503);
  }
}

export const POST = withApiErrors("app/api/tasks/channel/route.ts:POST", POSTHandler);
