import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { safeSecretEquals } from "@/lib/security";
import { verifyMainChannelMembership } from "@/lib/telegram-membership";

export const runtime = "nodejs";

function authorized(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return safeSecretEquals(bearer, secret) || safeSecretEquals(request.headers.get("x-mxm-cron-secret") || "", secret);
}

async function handler(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const candidates = await supabase
    .from("telegram_channel_task_state_v700")
    .select("profile_id,telegram_id,last_verified_at")
    .not("rewarded_at", "is", null)
    .is("revoked_at", null)
    .lte("last_verified_at", cutoff)
    .order("last_verified_at", { ascending: true, nullsFirst: true })
    .limit(100);
  if (candidates.error) return apiFailure(candidates.error, "Не удалось получить список подписок для проверки");

  let checked = 0;
  let revoked = 0;
  let failed = 0;
  for (const row of candidates.data || []) {
    try {
      const result = await verifyMainChannelMembership({ id: String(row.profile_id), telegram_id: Number(row.telegram_id) }, { force: true });
      checked += 1;
      if (result.revokedAt) revoked += 1;
    } catch (error) {
      failed += 1;
      console.warn("channel subscription audit item", { profileId: row.profile_id, error });
    }
  }

  return NextResponse.json({ ok: true, checked, revoked, failed, checkedAt: new Date().toISOString() }, {
    headers: { "cache-control": "private, no-store" },
  });
}

export const GET = withApiErrors("app/api/system/channel-subscription-audit/route.ts:GET", handler);
export const POST = withApiErrors("app/api/system/channel-subscription-audit/route.ts:POST", handler);
