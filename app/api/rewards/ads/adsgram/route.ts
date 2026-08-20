import { NextResponse } from "next/server";
import { rewardedAdsConfig, safeSecretEquals } from "@/lib/rewarded-ads";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function empty(status: number) {
  return new NextResponse(null, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const config = rewardedAdsConfig();
  if (!config.serverSecret) return empty(404);

  const url = new URL(request.url);
  const userIdRaw = String(
    url.searchParams.get("userId") ||
    url.searchParams.get("userid") ||
    url.searchParams.get("telegramId") ||
    url.searchParams.get("tgid") ||
    "",
  ).trim();
  const token = String(url.searchParams.get("token") || "").trim();

  if (!safeSecretEquals(token, config.serverSecret)) return empty(403);

  // Some dashboards may probe the configured template before replacing [userId].
  // A successful no-op confirms the HTTPS endpoint without crediting anyone.
  if (/^\[(?:userId|userid)\]$/i.test(userIdRaw) || /^\{(?:userId|userid)\}$/i.test(userIdRaw)) return empty(204);

  if (!/^\d{5,20}$/.test(userIdRaw)) return empty(400);
  if (!(await enforceRateLimit(request, "adsgram-server-reward", userIdRaw, 8, 300))) return empty(429);

  const telegramId = Number(userIdRaw);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return empty(400);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("claim_rewarded_ad_by_telegram_v045", { p_telegram_id: telegramId });
  if (error) {
    console.error("adsgram reward callback", { code: error.code, message: error.message });
    return empty(500);
  }

  const status = data && typeof data === "object" && "status" in data ? String((data as { status: unknown }).status) : "unknown";
  if (["claimed", "no_open_session", "limit", "cooldown", "expired"].includes(status)) return empty(204);
  if (status === "missing_profile") return empty(404);
  return empty(202);
}
