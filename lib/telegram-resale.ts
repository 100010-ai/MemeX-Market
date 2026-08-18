/**
 * Legacy compatibility shim.
 *
 * MXM no longer uses MTProto/@mtcute user sessions for the production Gift
 * catalogue. This file intentionally contains no @mtcute dependency so old
 * repository trees that still contain lib/telegram-resale.ts cannot break
 * TypeScript/Vercel builds after an archive is extracted over them.
 */
export function globalResaleCatalogConfigured() {
  return false;
}

export async function ensureGlobalGiftMarket(): Promise<never> {
  throw new Error("Legacy MTProto resale importer was removed. Use the current Gift catalogue/NPC market pipeline instead.");
}
