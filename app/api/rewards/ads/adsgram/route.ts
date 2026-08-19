import { NextResponse } from "next/server";
import { rewardedAdsConfig, safeSecretEquals } from "@/lib/rewarded-ads";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = rewardedAdsConfig();
  if (!config.serverSecret) return new NextResponse(null, { status: 404 });

  const url = new URL(request.url);
  const userIdRaw = String(url.searchParams.get("userId") || url.searchParams.get("userid") || "").trim();
  const token = String(url.searchParams.get("token") || "").trim();
  if (!safeSecretEquals(token, config.serverSecret)) return new NextResponse(null, { status: 403 });
  if (!/^\d{5,20}$/.test(userIdRaw)) return new NextResponse(null, { status: 400 });
  if (!(await enforceRateLimit(request, "adsgram-server-reward", userIdRaw, 8, 300))) return new NextResponse(null, { status: 429 });

  const telegramId = Number(userIdRaw);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return new NextResponse(null, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("claim_rewarded_ad_by_telegram_v045", { p_telegram_id: telegramId });
  if (error) {
    console.error("adsgram reward callback", { code: error.code, message: error.message });
    return new NextResponse(null, { status: 500 });
  }
  const status = data && typeof data === "object" && "status" in data ? String((data as { status: unknown }).status) : "unknown";
  if (["claimed", "no_open_session"].includes(status)) return new NextResponse(null, { status: 204 });
  if (status === "missing_profile") return new NextResponse(null, { status: 404 });
  if (status === "limit" || status === "cooldown" || status === "expired") return new NextResponse(null, { status: 204 });
  return new NextResponse(null, { status: 202 });
}
