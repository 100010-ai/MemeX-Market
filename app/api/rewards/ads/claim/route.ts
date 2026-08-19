import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { rewardedAdsConfig } from "@/lib/rewarded-ads";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";

export const runtime = "nodejs";

type SessionRow = { id: string; status: "created" | "claimed" | "expired"; reward: number | string; claimed_at: string | null; verification_source: string | null };

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "rewarded-ad-claim", String(profile.id), 18, 300))) {
    return NextResponse.json({ error: "Слишком много проверок награды" }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const sessionId = String(body.sessionId || "").trim();
  if (!validUuidLike(sessionId)) return NextResponse.json({ error: "Некорректная рекламная сессия" }, { status: 400 });

  const config = rewardedAdsConfig();
  const supabase = getSupabaseAdmin();

  if (config.verificationMode === "client") {
    const { data, error } = await supabase.rpc("claim_rewarded_ad_session_client_v045", {
      p_profile_id: profile.id,
      p_session_id: sessionId,
    });
    if (error) {
      console.error("rewarded ad fallback claim", error);
      return NextResponse.json({ error: "Не удалось начислить рекламную награду" }, { status: 400 });
    }
    const result = data as Record<string, unknown>;
    return NextResponse.json({ claimed: result.status === "claimed", pending: result.status === "pending", result, verificationMode: "client" }, { headers: { "cache-control": "no-store" } });
  }

  if (config.verificationMode !== "server") {
    return NextResponse.json({ error: "Серверное подтверждение рекламы не настроено" }, { status: 503 });
  }

  // This request proves only that the client finished the SDK flow. It does NOT credit balance.
  await supabase.from("rewarded_ad_sessions").update({ client_completed_at: new Date().toISOString() }).eq("id", sessionId).eq("profile_id", profile.id).eq("status", "created");
  const { data, error } = await supabase.from("rewarded_ad_sessions")
    .select("id,status,reward,claimed_at,verification_source")
    .eq("id", sessionId)
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (error) {
    console.error("rewarded ad verify", error);
    return NextResponse.json({ error: "Не удалось проверить рекламную награду" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Рекламная сессия не найдена" }, { status: 404 });
  const session = data as SessionRow;
  if (session.status === "claimed") {
    return NextResponse.json({ claimed: true, pending: false, result: { reward: Number(session.reward), claimedAt: session.claimed_at }, verificationMode: "server" }, { headers: { "cache-control": "no-store" } });
  }
  if (session.status === "expired") return NextResponse.json({ claimed: false, pending: false, expired: true, verificationMode: "server" }, { status: 410, headers: { "cache-control": "no-store" } });
  return NextResponse.json({ claimed: false, pending: true, verificationMode: "server" }, { status: 202, headers: { "cache-control": "no-store" } });
}
