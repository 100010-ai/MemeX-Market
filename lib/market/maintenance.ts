import { getSupabaseAdmin } from "@/lib/supabase/admin";

let nextMaintenanceAt = 0;
let maintenancePromise: Promise<void> | null = null;

/**
 * Request-adjacent market housekeeping must stay short and deterministic.
 *
 * Heavy catalogue discovery/import is intentionally not performed here. This
 * function is invoked from Next.js `after()`, and Vercel still counts that work
 * against the function duration. Running TonAPI discovery and NPC bootstrap in
 * this path could return a successful `/api/market` response and then keep the
 * invocation alive until the 60 second runtime timeout.
 *
 * Catalogue synchronization remains available through the dedicated admin
 * catalogue-sync flow, where it has its own rate limit and execution budget.
 */
export async function maybeMaintainGiftMarket(intervalMs = 60_000) {
  const now = Date.now();
  if (now < nextMaintenanceAt) return;
  if (maintenancePromise) return maintenancePromise;

  nextMaintenanceAt = now + Math.max(15_000, intervalMs);
  maintenancePromise = (async () => {
    const { error } = await getSupabaseAdmin().rpc("expire_market_orders");
    if (error) throw error;
  })().finally(() => {
    maintenancePromise = null;
  });

  return maintenancePromise;
}
