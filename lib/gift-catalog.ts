import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { importTelegramGiftCatalog, type GiftCatalogImportResult } from "@/lib/gifts";

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
      successful += 1;
      assetsUpserted += result.assetsUpserted;
      results.push(result);
      await supabase
        .from("gift_catalog_sources")
        .update({ last_synced_at: result.syncedAt, last_error: null, updated_at: result.syncedAt })
        .eq("id", source.id);
    } catch (sourceError) {
      failed += 1;
      const message = sourceError instanceof Error ? sourceError.message : "Неизвестная ошибка Telegram каталога";
      results.push({ telegramId, error: message });
      await supabase
        .from("gift_catalog_sources")
        .update({ last_error: message.slice(0, 1000), updated_at: new Date().toISOString() })
        .eq("id", source.id);
    }
  }

  return { sources: sources.length, successful, failed, assetsUpserted, results };
}
