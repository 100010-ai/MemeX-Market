import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { syncTonApiGiftCatalog } from "@/lib/tonapi-gifts";
import { ensureGenesisGiftMarket } from "@/lib/npc-market";

let nextMaintenanceAt = 0;
let nextCatalogExpandAt = 0;
let maintenancePromise: Promise<void> | null = null;


/** Opportunistic housekeeping + gradual catalog expansion. */
export async function maybeMaintainGiftMarket(intervalMs = 60_000) {
  const now = Date.now();
  if (now < nextMaintenanceAt) return;
  if (maintenancePromise) return maintenancePromise;
  nextMaintenanceAt = now + Math.max(15_000, intervalMs);
  maintenancePromise = (async () => {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("expire_market_orders");
    if (error) throw error;

    if (Date.now() >= nextCatalogExpandAt) {
      nextCatalogExpandAt = Date.now() + 5 * 60_000;
      try {
        const hasKey = Boolean(process.env.TONAPI_KEY?.trim());
        await syncTonApiGiftCatalog({ discoverPages: 1, maxCollections: hasKey ? 5 : 2, itemsPerCollection: hasKey ? 400 : 120 });
        await ensureGenesisGiftMarket({ batchSize: hasKey ? 500 : 160, force: false });
      } catch (catalogError) {
        console.warn("gift catalog background expansion", catalogError instanceof Error ? catalogError.message : catalogError);
      }
    }
  })().finally(() => { maintenancePromise = null; });
  return maintenancePromise;
}
