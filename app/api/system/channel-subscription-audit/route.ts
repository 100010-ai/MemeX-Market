import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { safeSecretEquals } from "@/lib/security";
import { verifyMainChannelMembership } from "@/lib/telegram-membership";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return safeSecretEquals(bearer, secret) || safeSecretEquals(request.headers.get("x-mxm-cron-secret") || "", secret);
}

async function handler(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const candidates = await supabase
    .from("telegram_channel_task_state_v700")
    .select("profile_id,telegram_id,last_verified_at")
    .not("rewarded_at", "is", null)
    .is("revoked_at", null)
    .lte("last_verified_at", cutoff)
    .order("last_verified_at", { ascending: true, nullsFirst: true })
    .limit(40);
  if (candidates.error) return apiFailure(candidates.error, "Не удалось получить список подписок для проверки");

  let checked = 0;
  let revoked = 0;
  let failed = 0;
  const queue = [...(candidates.data || [])];
  const worker = async () => {
    while (queue.length) {
      const row = queue.shift();
      if (!row) return;
      try {
        const result = await verifyMainChannelMembership({ id: String(row.profile_id), telegram_id: Number(row.telegram_id) }, { force: true });
        checked += 1;
        if (result.revokedAt) revoked += 1;
      } catch (error) {
        failed += 1;
        console.warn("channel subscription audit item", { profileId: row.profile_id, error });
      }
    }
  };
  // A sequential 100-user audit could exceed a serverless execution window if
  // Telegram is slow. Eight bounded workers keep the run short without
  // hammering getChatMember.
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, () => worker()));

  return NextResponse.json({ ok: true, checked, revoked, failed, checkedAt: new Date().toISOString() }, {
    headers: { "cache-control": "private, no-store" },
  });
}

export const GET = withApiErrors("app/api/system/channel-subscription-audit/route.ts:GET", handler);
export const POST = withApiErrors("app/api/system/channel-subscription-audit/route.ts:POST", handler);
