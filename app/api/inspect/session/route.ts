import { NextResponse } from "next/server";
import { withApiErrors, apiFailure } from "@/lib/api-route";
import { getProfileSnapshot } from "@/lib/auth";
import { sameOriginMutation } from "@/lib/security";
import { setSession } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function inspectorAvailable() {
  return process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV === "development";
}

async function POSTHandler(request: Request) {
  if (!inspectorAvailable()) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });

  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("profiles")
    .select("id,telegram_id,username,first_name,last_name,photo_url,balance,xp,last_gift_sync_at,is_banned,banned_until,created_at")
    .eq("is_system", true)
    .eq("is_banned", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (result.error) return apiFailure(result.error, "Не удалось открыть режим инспектора");
  if (!result.data || !Number.isSafeInteger(Number(result.data.telegram_id)) || Number(result.data.telegram_id) >= 0) {
    return NextResponse.json({ error: "Системный профиль для инспектора не найден" }, { status: 503 });
  }

  await setSession(Number(result.data.telegram_id), { inspector: true, maxAgeSeconds: 60 * 60 * 2 });
  return NextResponse.json({
    profile: await getProfileSnapshot(result.data as Record<string, unknown>),
    inspectionMode: true,
  }, { headers: { "cache-control": "private, no-store" } });
}

export const POST = withApiErrors("app/api/inspect/session/route.ts:POST", POSTHandler);
