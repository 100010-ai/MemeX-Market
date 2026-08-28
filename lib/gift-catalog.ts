import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { importTelegramGiftCatalog, type GiftCatalogImportResult } from "@/lib/gifts";
import { syncTonApiGiftCatalog, type TonApiGiftSyncResult } from "@/lib/tonapi-gifts";

export type CatalogSource = {
  id: string;
  telegramId: number;
  label: string | null;
  active: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export async function syncConfiguredGiftCatalogSources(): Promise<{
  sources: number;
  successful: number;
  failed: number;
  assetsUpserted: number;
  results: Array<GiftCatalogImportResult | { telegramId: number; error: string }>;
}> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("gift_catalog_sources")
    .select("id,telegram_id,label,active")
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const sources = data || [];
  const results: Array<GiftCatalogImportResult | { telegramId: number; error: string }> = [];
  let successful = 0;
  let failed = 0;
  let assetsUpserted = 0;

  // Sequential on purpose: this is a local/admin operation and should not
  // burst the Telegram Bot API when several catalogue sources are configured.
  for (const source of sources) {
    const telegramId = Number(source.telegram_id);
    try {
      const result = await importTelegramGiftCatalog(telegramId);
      const sourceUpdate = await supabase
        .from("gift_catalog_sources")
        .update({ last_synced_at: result.syncedAt, last_error: null, updated_at: result.syncedAt })
        .eq("id", source.id);
      if (sourceUpdate.error) throw sourceUpdate.error;
      successful += 1;
      assetsUpserted += result.assetsUpserted;
      results.push(result);
    } catch (sourceError) {
      failed += 1;
      const message = sourceError instanceof Error ? sourceError.message : "Неизвестная ошибка Telegram каталога";
      results.push({ telegramId, error: message });
      const failureUpdate = await supabase
        .from("gift_catalog_sources")
        .update({ last_error: message.slice(0, 1000), updated_at: new Date().toISOString() })
        .eq("id", source.id);
      if (failureUpdate.error) console.error("gift catalog source failure state", failureUpdate.error);
    }
  }

  return { sources: sources.length, successful, failed, assetsUpserted, results };
}

export async function syncGiftCatalog(): Promise<{
  bot: Awaited<ReturnType<typeof syncConfiguredGiftCatalogSources>>;
  tonapi: TonApiGiftSyncResult | { error: string };
  totalAssetsUpserted: number;
}> {
  const bot = await syncConfiguredGiftCatalogSources();
  let tonapi: TonApiGiftSyncResult | { error: string };
  try {
    // Collection discovery and item imports are cursor-backed. Keep each admin
    // pass incremental so the route stays comfortably below its 60s function
    // budget instead of trying to sweep thousands of TonAPI items at once.
    tonapi = await syncTonApiGiftCatalog({ discoverPages: 1, maxCollections: 4, itemsPerCollection: 160 });
  } catch (error) {
    tonapi = { error: error instanceof Error ? error.message : "TonAPI sync failed" };
  }
  return {
    bot,
    tonapi,
    totalAssetsUpserted: bot.assetsUpserted + ("assetsUpserted" in tonapi ? tonapi.assetsUpserted : 0),
  };
}
