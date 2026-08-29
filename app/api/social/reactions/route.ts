import { apiFailure, readJsonObject, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "social-reaction", String(profile.id), 120, 60))) return NextResponse.json({ error: "Слишком много реакций" }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const reaction = body.reaction === "fire" || body.reaction === "eyes" || body.reaction === "diamond" ? body.reaction : null;
  if (!validUuidLike(eventId) || !reaction) return NextResponse.json({ error: "Некорректная реакция" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().rpc("social_toggle_reaction_v200", { p_profile_id: profile.id, p_event_id: eventId, p_reaction: reaction });
  if (error) return apiFailure(error, "Не удалось поставить реакцию", 400);
  return NextResponse.json({ reaction: data }, { headers: { "cache-control": "no-store" } });
}
export const POST = withApiErrors("app/api/social/reactions/route.ts:POST", POSTHandler);
