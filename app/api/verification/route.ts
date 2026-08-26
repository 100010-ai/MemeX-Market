import { NextResponse } from "next/server";
import { readJsonObject, withApiErrors } from "@/lib/api-route";
import { requireProfile } from "@/lib/auth";
import { enforceRateLimit, sameOriginMutation, validUuidLike } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { text } from "@/lib/safe-data";

async function GETHandler() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const [creator, coins, requests] = await Promise.all([
    supabase.from("creator_verifications_v071").select("tier,verified_at").eq("profile_id", profile.id).is("revoked_at", null).maybeSingle(),
    supabase.from("coin_verifications_v071").select("coin_id,tier,verified_at,coins!inner(creator_profile_id)").eq("coins.creator_profile_id", profile.id).is("revoked_at", null),
    supabase.from("verification_requests_v071").select("id,target_type,coin_id,status,requested_at,reviewed_at,review_note,tier,coins(name,symbol)").eq("profile_id", profile.id).order("requested_at", { ascending: false }).limit(30),
  ]);
  const error = creator.error || coins.error || requests.error;
  if (error) throw error;
  return NextResponse.json({ creator: creator.data || null, coins: coins.data || [], requests: requests.data || [] }, { headers: { "cache-control": "private, no-store" } });
}

async function POSTHandler(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "verification-request", profile.id, 3, 86_400))) return NextResponse.json({ error: "Не больше трёх заявок в сутки" }, { status: 429 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  const targetType = body.targetType === "creator" ? "creator" : body.targetType === "coin" ? "coin" : null;
  const coinId = targetType === "coin" ? text(body.coinId, "", 80) : null;
  const evidence = text(body.evidence, "", 1200);
  if (!targetType || evidence.length < 20) return NextResponse.json({ error: "Кратко опишите проект и основания для проверки" }, { status: 400 });
  if (targetType === "coin" && (!coinId || !validUuidLike(coinId))) return NextResponse.json({ error: "Выберите мемкоин" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  if (coinId) {
    const owned = await supabase.from("coins").select("id").eq("id", coinId).eq("creator_profile_id", profile.id).maybeSingle();
    if (owned.error) throw owned.error;
    if (!owned.data) return NextResponse.json({ error: "Можно отправить только свой мемкоин" }, { status: 403 });
  }
  const verified = targetType === "creator"
    ? await supabase.from("creator_verifications_v071").select("profile_id").eq("profile_id", profile.id).is("revoked_at", null).maybeSingle()
    : await supabase.from("coin_verifications_v071").select("coin_id").eq("coin_id", coinId!).is("revoked_at", null).maybeSingle();
  if (verified.error) throw verified.error;
  if (verified.data) return NextResponse.json({ error: "Объект уже верифицирован" }, { status: 409 });

  const created = await supabase.from("verification_requests_v071").insert({ profile_id: profile.id, target_type: targetType, coin_id: coinId, evidence }).select("id,status,requested_at").single();
  if (created.error) {
    if (created.error.code === "23505") return NextResponse.json({ error: "Заявка уже находится на проверке" }, { status: 409 });
    throw created.error;
  }
  return NextResponse.json({ ok: true, request: created.data }, { status: 201, headers: { "cache-control": "no-store" } });
}

export const GET = withApiErrors("app/api/verification/route.ts:GET", GETHandler);
export const POST = withApiErrors("app/api/verification/route.ts:POST", POSTHandler);
