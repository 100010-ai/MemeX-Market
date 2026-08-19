import { getSupabaseAdmin } from "@/lib/supabase/admin";

let nextMaintenanceAt = 0;
let maintenancePromise: Promise<void> | null = null;

function isMissingFunction(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "42883" || /expire_market_orders|schema cache|could not find the function/i.test(error.message || "")));
}

/**
 * Opportunistic market housekeeping. It is deliberately throttled and safe to
 * call from read routes: one request performs the cleanup and all concurrent
 * requests reuse it. PostgreSQL remains the authority for expiry checks.
 */
export async function maybeMaintainGiftMarket(intervalMs = 60_000) {
  const now = Date.now();
  if (now < nextMaintenanceAt) return;
  if (maintenancePromise) return maintenancePromise;
  nextMaintenanceAt = now + Math.max(15_000, intervalMs);
  maintenancePromise = (async () => {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("expire_market_orders");
    if (error && !isMissingFunction(error)) console.warn("gift market maintenance", error);
  })().finally(() => { maintenancePromise = null; });
  return maintenancePromise;
}
