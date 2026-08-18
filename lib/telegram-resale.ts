import { gunzipSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type AnyRecord = Record<string, any>;

type GlobalCatalogResult = {
  runId: string | null;
  skipped: boolean;
  reason: string;
  collectionsScanned: number;
  resaleGiftsSeen: number;
  assetsUpserted: number;
  virtualListingsCreated: number;
  mediaObjectsUploaded: number;
  skippedWithoutTonPrice: number;
};

const NANO_TON = 1_000_000_000;

function envInt(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

function envNumber(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}

export function globalResaleCatalogConfigured() {
  return Boolean(process.env.TELEGRAM_API_ID?.trim() && process.env.TELEGRAM_API_HASH?.trim() && process.env.TELEGRAM_USER_SESSION?.trim());
}

function telegramCredentials() {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH?.trim();
  const session = process.env.TELEGRAM_USER_SESSION?.trim();
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash || !session) {
    throw new Error("TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_USER_SESSION are required for the global Telegram resale catalogue");
  }
  return { apiId, apiHash, session };
}

function readValue<T = any>(source: AnyRecord | null | undefined, key: string): T | null {
  if (!source) return null;
  const value = source[key];
  if (typeof value === "function") return value.call(source) as T;
  return value == null ? null : value as T;
}

function longString(value: unknown) {
  if (value == null) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  const text = String(value);
  return /^-?\d+$/.test(text) ? text : null;
}

function longPositive(value: unknown) {
  const text = longString(value);
  return text ? BigInt(text) > BigInt(0) : false;
}

function positiveFlag(value: unknown) {
  return value === true || longPositive(value);
}

function baseGiftHasResale(gift: AnyRecord) {
  const availability = readValue<AnyRecord>(gift, "availability");
  const raw = readValue<AnyRecord>(gift, "raw");
  return Boolean(
    (availability && positiveFlag(readValue(availability, "resale"))) ||
    positiveFlag(readValue(gift, "availabilityResale")) ||
    positiveFlag(readValue(gift, "availability_resale")) ||
    positiveFlag(readValue(raw, "availabilityResale")) ||
    positiveFlag(readValue(raw, "availability_resale"))
  );
}

function nanoTon(value: unknown) {
  const text = longString(value);
  if (!text) return null;
  const raw = BigInt(text);
  if (raw <= BigInt(0)) return null;
  const whole = raw / BigInt("1000000000");
  const fraction = raw % BigInt("1000000000");
  return Number(whole) + Number(fraction) / NANO_TON;
}

function exactPermille(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 1000) throw new Error(`${label} has no exact Telegram rarity_per_mille`);
  return number;
}

function exactText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is missing in Telegram resale data`);
  return value.trim();
}

function exactInt(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} is invalid in Telegram resale data`);
  return number;
}

function stickerInfo(sticker: AnyRecord, label: string) {
  const fileId = readValue<string>(sticker, "fileId");
  const uniqueFileId = readValue<string>(sticker, "uniqueFileId");
  const mimeType = readValue<string>(sticker, "mimeType") || "application/octet-stream";
  const width = Number(readValue(sticker, "width"));
  const height = Number(readValue(sticker, "height"));
  if (!fileId || !uniqueFileId) throw new Error(`${label} has no Telegram file identity`);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) throw new Error(`${label} has invalid dimensions`);
  const kind = mimeType.includes("tgsticker") || mimeType.includes("lottie") ? "animated" : mimeType.startsWith("video/") ? "video" : "static";
  const thumbs = readValue<any[]>(sticker, "thumbnails") || [];
  const thumb = [...thumbs].reverse().find((item) => {
    const id = readValue<string>(item, "fileId");
    const isVideo = Boolean(readValue(item, "isVideo"));
    return Boolean(id && !isVideo);
  });
  return {
    fileId,
    uniqueFileId,
    mimeType,
    width,
    height,
    kind: kind as "static" | "animated" | "video",
    thumbFileId: thumb ? readValue<string>(thumb, "fileId") : null,
  };
}

function safePath(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "gift";
}

async function mirrorSticker(client: AnyRecord, sticker: AnyRecord, slug: string, role: "model" | "symbol") {
  const info = stickerInfo(sticker, `${slug} ${role}`);
  const supabase = getSupabaseAdmin();
  const folder = await mkdtemp(join(tmpdir(), "mxm-gift-"));
  try {
    const downloaded = join(folder, `${role}.bin`);
    await client.downloadToFile(downloaded, sticker as any);
    let bytes = await readFile(downloaded);
    let contentType = info.mimeType;
    let extension = "bin";
    if (info.kind === "animated") {
      try { bytes = gunzipSync(bytes); } catch { /* Telegram may already expose plain JSON in future layers. */ }
      JSON.parse(bytes.toString("utf8"));
      contentType = "application/json";
      extension = "json";
    } else if (info.kind === "video") {
      contentType = "video/webm";
      extension = "webm";
    } else if (info.mimeType.includes("webp")) {
      contentType = "image/webp";
      extension = "webp";
    } else if (info.mimeType.includes("png")) {
      contentType = "image/png";
      extension = "png";
    } else if (info.mimeType.includes("jpeg") || info.mimeType.includes("jpg")) {
      contentType = "image/jpeg";
      extension = "jpg";
    } else {
      throw new Error(`${slug} ${role} has unsupported Telegram media type ${info.mimeType}`);
    }
    if (bytes.byteLength > 8 * 1024 * 1024) throw new Error(`${slug} ${role} media exceeds the 8 MB mirror limit`);
    const path = `telegram/${safePath(info.uniqueFileId)}/asset.${extension}`;
    const { error } = await supabase.storage.from("gift-media").upload(path, bytes, { contentType, upsert: true, cacheControl: "31536000" });
    if (error) throw error;
    const { data } = supabase.storage.from("gift-media").getPublicUrl(path);
    if (!data.publicUrl) throw new Error(`Could not build public URL for ${slug} ${role}`);
    return { url: data.publicUrl, info };
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}

function normalizedGift(unique: AnyRecord, baseGiftId: unknown) {
  const slug = exactText(readValue(unique, "slug"), "Gift slug");
  const title = exactText(readValue(unique, "title"), `${slug} title`);
  const number = exactInt(readValue(unique, "num"), `${slug} number`);
  const model = readValue<AnyRecord>(unique, "model");
  const pattern = readValue<AnyRecord>(unique, "pattern");
  const backdrop = readValue<AnyRecord>(unique, "backdrop");
  if (!model || !pattern || !backdrop) throw new Error(`${slug} does not contain complete Telegram traits`);
  const modelSticker = readValue<AnyRecord>(model, "sticker");
  const symbolSticker = readValue<AnyRecord>(pattern, "sticker");
  if (!modelSticker || !symbolSticker) throw new Error(`${slug} does not contain complete Telegram sticker traits`);
  const modelInfo = stickerInfo(modelSticker, `${slug} model`);
  const symbolInfo = stickerInfo(symbolSticker, `${slug} symbol`);
  const priceTon = nanoTon(readValue(unique, "resellPriceTon"));
  const baseId = longString(baseGiftId);
  if (!baseId) throw new Error(`${slug} base Gift ID is invalid`);
  const isBurned = Boolean(readValue(unique, "isBurned"));
  const giftAddress = readValue<string>(unique, "giftAddress");
  const modelPermille = exactPermille(readValue(model, "permille"), `${slug} model`);
  const symbolPermille = exactPermille(readValue(pattern, "permille"), `${slug} symbol`);
  const backdropPermille = exactPermille(readValue(backdrop, "permille"), `${slug} backdrop`);
  const backdropCenter = Number(readValue(backdrop, "centerColor"));
  const backdropEdge = Number(readValue(backdrop, "edgeColor"));
  const backdropPattern = Number(readValue(backdrop, "patternColor"));
  const backdropText = Number(readValue(backdrop, "textColor"));
  for (const [name, color] of [["center", backdropCenter], ["edge", backdropEdge], ["pattern", backdropPattern], ["text", backdropText]] as const) {
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff) throw new Error(`${slug} ${name} backdrop color is invalid`);
  }
  return {
    slug,
    title,
    number,
    baseId,
    priceTon,
    isBurned,
    isPremium: Boolean(readValue(unique, "isPremiumOnly")),
    isFromBlockchain: Boolean(giftAddress),
    giftAddress: giftAddress || null,
    model,
    pattern,
    backdrop,
    modelSticker,
    symbolSticker,
    modelInfo,
    symbolInfo,
    modelName: exactText(readValue(model, "name"), `${slug} model name`),
    symbolName: exactText(readValue(pattern, "name"), `${slug} symbol name`),
    backdropName: exactText(readValue(backdrop, "name"), `${slug} backdrop name`),
    modelPermille,
    symbolPermille,
    backdropPermille,
    backdropCenter,
    backdropEdge,
    backdropPattern,
    backdropText,
  };
}

async function listedGiftCount() {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase.from("virtual_gifts").select("id", { head: true, count: "exact" }).eq("status", "listed");
  if (error) throw error;
  return count || 0;
}

async function markRun(runId: string, patch: Record<string, unknown>) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("catalog_sync_runs").update(patch).eq("id", runId);
  if (error) console.error("catalog sync run update", error);
}

export async function ensureGlobalGiftMarket(options: { minListings?: number; force?: boolean; reason?: string } = {}): Promise<GlobalCatalogResult> {
  const minListings = options.minListings ?? envInt("MARKET_BOOTSTRAP_MIN_LISTINGS", 12, 4, 120);
  const current = await listedGiftCount();
  if (!options.force && current >= minListings) {
    return { runId: null, skipped: true, reason: "liquidity-ok", collectionsScanned: 0, resaleGiftsSeen: 0, assetsUpserted: 0, virtualListingsCreated: 0, mediaObjectsUploaded: 0, skippedWithoutTonPrice: 0 };
  }
  if (!globalResaleCatalogConfigured()) {
    throw new Error("Global Telegram resale catalogue is not configured");
  }

  const supabase = getSupabaseAdmin();
  const { data: locked, error: lockError } = await supabase.rpc("acquire_global_catalog_lock", { p_seconds: 180 });
  if (lockError) throw lockError;
  if (!locked) {
    return { runId: null, skipped: true, reason: "sync-already-running", collectionsScanned: 0, resaleGiftsSeen: 0, assetsUpserted: 0, virtualListingsCreated: 0, mediaObjectsUploaded: 0, skippedWithoutTonPrice: 0 };
  }

  const { data: run, error: runError } = await supabase.from("catalog_sync_runs").insert({ source: "telegram_resale", status: "running", reason: options.reason || (options.force ? "manual" : "bootstrap") }).select("id").single();
  if (runError || !run) {
    await supabase.rpc("release_global_catalog_lock", { p_success: false, p_error: "Could not create catalogue sync run" });
    throw runError || new Error("Could not create catalogue sync run");
  }
  const runId = String(run.id);
  const stats = { collectionsScanned: 0, resaleGiftsSeen: 0, assetsUpserted: 0, virtualListingsCreated: 0, mediaObjectsUploaded: 0, skippedWithoutTonPrice: 0 };
  let client: AnyRecord | null = null;
  try {
    const { apiId, apiHash, session } = telegramCredentials();
    const mtcute = await import("@mtcute/node");
    client = new mtcute.TelegramClient({ apiId, apiHash }) as AnyRecord;
    await client.start({ session });

    const targetNew = options.force ? envInt("MARKET_CATALOG_TARGET_LISTINGS", 36, 8, 160) : Math.max(0, minListings - current);
    const maxCollections = envInt("MARKET_CATALOG_COLLECTIONS_PER_SYNC", 12, 2, 40);
    const bootstrapScanCollections = envInt("MARKET_BOOTSTRAP_SCAN_COLLECTIONS", 32, 4, 80);
    const itemsPerCollection = envInt("MARKET_CATALOG_ITEMS_PER_COLLECTION", 4, 1, 12);
    const maxInitialPrice = envNumber("MARKET_BOOTSTRAP_MAX_PRICE_TON", 95, 0.01, 1_000_000);
    const scanPerCollection = Math.max(itemsPerCollection * 4, 16);
    const mediaCache = new Map<string, string>();

    const baseOptions = Array.from(await client.getStarGiftOptions() as any) as AnyRecord[];
    const explicitlyResold = baseOptions.filter(baseGiftHasResale);
    // mtcute exposes high-level wrappers, while Telegram evolves raw field names between layers.
    // If a wrapper does not surface availability_resale, scan the real base Gift IDs directly;
    // only getStarGiftResaleOptions results are ever persisted, so no market data is fabricated.
    const resaleBases = (explicitlyResold.length ? explicitlyResold : baseOptions)
      .filter((gift) => readValue(gift, "id") != null)
      .sort((a, b) => {
        const ta = String(readValue(a, "title") || readValue(a, "id") || "");
        const tb = String(readValue(b, "title") || readValue(b, "id") || "");
        return ta.localeCompare(tb, "en");
      });
    if (!resaleBases.length) throw new Error("Telegram returned no Gift types that can be checked for resale inventory");

    const day = Math.floor(Date.now() / 86_400_000);
    const offset = day % resaleBases.length;
    const scanLimit = current === 0 ? Math.min(bootstrapScanCollections, resaleBases.length) : Math.min(maxCollections, resaleBases.length);
    const rotated = resaleBases.slice(offset).concat(resaleBases.slice(0, offset)).slice(0, scanLimit);

    for (const base of rotated) {
      if (!options.force && stats.virtualListingsCreated >= targetNew) break;
      if (options.force && stats.virtualListingsCreated >= targetNew) break;
      const baseId = readValue(base, "id");
      if (baseId == null) continue;
      let resale: AnyRecord[];
      try {
        resale = Array.from(await client.getStarGiftResaleOptions({ giftId: baseId, limit: scanPerCollection, sort: "price" }) as any) as AnyRecord[];
      } catch (error) {
        console.warn("skip Telegram base Gift without usable resale inventory", String(error));
        continue;
      }
      stats.collectionsScanned += 1;
      stats.resaleGiftsSeen += resale.length;
      let acceptedInCollection = 0;
      for (const unique of resale) {
        if (acceptedInCollection >= itemsPerCollection) break;
        let normalized: ReturnType<typeof normalizedGift>;
        try { normalized = normalizedGift(unique, baseId); } catch (error) { console.warn("skip Telegram resale Gift", error); continue; }
        if (normalized.isBurned) continue;
        if (normalized.priceTon == null) { stats.skippedWithoutTonPrice += 1; continue; }
        if (normalized.priceTon > maxInitialPrice) continue;

        const { data: existing, error: existingError } = await supabase.from("gift_assets").select("id,model_media_url,symbol_media_url").eq("telegram_name", normalized.slug).maybeSingle();
        if (existingError) throw existingError;
        let modelMediaUrl = existing?.model_media_url ? String(existing.model_media_url) : null;
        let symbolMediaUrl = existing?.symbol_media_url ? String(existing.symbol_media_url) : null;
        if (modelMediaUrl) mediaCache.set(normalized.modelInfo.uniqueFileId, modelMediaUrl);
        if (symbolMediaUrl) mediaCache.set(normalized.symbolInfo.uniqueFileId, symbolMediaUrl);

        const mirrorMissing = async (role: "model" | "symbol") => {
          const info = role === "model" ? normalized.modelInfo : normalized.symbolInfo;
          const sticker = role === "model" ? normalized.modelSticker : normalized.symbolSticker;
          const cached = mediaCache.get(info.uniqueFileId);
          if (cached) return { url: cached, uploaded: false };
          const mirrored = await mirrorSticker(client!, sticker, normalized.slug, role);
          mediaCache.set(info.uniqueFileId, mirrored.url);
          return { url: mirrored.url, uploaded: true };
        };

        const [modelMirror, symbolMirror] = await Promise.all([
          modelMediaUrl ? Promise.resolve({ url: modelMediaUrl, uploaded: false }) : mirrorMissing("model"),
          symbolMediaUrl ? Promise.resolve({ url: symbolMediaUrl, uploaded: false }) : mirrorMissing("symbol"),
        ]);
        modelMediaUrl = modelMirror.url;
        symbolMediaUrl = symbolMirror.url;
        stats.mediaObjectsUploaded += Number(modelMirror.uploaded) + Number(symbolMirror.uploaded);

        const now = new Date().toISOString();
        const payload = {
          source: "telegram_resale",
          slug: normalized.slug,
          giftId: normalized.baseId,
          title: normalized.title,
          number: normalized.number,
          resalePriceTon: normalized.priceTon,
          giftAddress: normalized.giftAddress,
          model: { name: normalized.modelName, rarityPerMille: normalized.modelPermille, fileId: normalized.modelInfo.fileId, uniqueFileId: normalized.modelInfo.uniqueFileId, mimeType: normalized.modelInfo.mimeType },
          symbol: { name: normalized.symbolName, rarityPerMille: normalized.symbolPermille, fileId: normalized.symbolInfo.fileId, uniqueFileId: normalized.symbolInfo.uniqueFileId, mimeType: normalized.symbolInfo.mimeType },
          backdrop: { name: normalized.backdropName, rarityPerMille: normalized.backdropPermille, centerColor: normalized.backdropCenter, edgeColor: normalized.backdropEdge, symbolColor: normalized.backdropPattern, textColor: normalized.backdropText },
          observedAt: now,
        };
        const row = {
          telegram_name: normalized.slug,
          gift_id: normalized.baseId,
          base_name: normalized.title,
          gift_number: normalized.number,
          model_name: normalized.modelName,
          model_rarity_per_mille: normalized.modelPermille,
          model_rarity: null,
          model_file_id: normalized.modelInfo.fileId,
          model_thumb_file_id: normalized.modelInfo.thumbFileId,
          model_is_animated: normalized.modelInfo.kind === "animated",
          model_is_video: normalized.modelInfo.kind === "video",
          symbol_name: normalized.symbolName,
          symbol_rarity_per_mille: normalized.symbolPermille,
          symbol_file_id: normalized.symbolInfo.fileId,
          symbol_thumb_file_id: normalized.symbolInfo.thumbFileId,
          symbol_is_animated: normalized.symbolInfo.kind === "animated",
          symbol_is_video: normalized.symbolInfo.kind === "video",
          backdrop_name: normalized.backdropName,
          backdrop_rarity_per_mille: normalized.backdropPermille,
          backdrop_center_color: normalized.backdropCenter,
          backdrop_edge_color: normalized.backdropEdge,
          backdrop_symbol_color: normalized.backdropPattern,
          backdrop_text_color: normalized.backdropText,
          is_premium: normalized.isPremium,
          is_burned: false,
          is_from_blockchain: normalized.isFromBlockchain,
          telegram_payload: payload,
          last_seen_at: now,
          updated_at: now,
          catalog_source: "telegram_resale",
          source_reference: `telegram-resale:${normalized.baseId}`,
          telegram_resale_price_ton: normalized.priceTon,
          resale_seen_at: now,
          model_media_url: modelMediaUrl,
          symbol_media_url: symbolMediaUrl,
        };
        const { data: asset, error: assetError } = await supabase.from("gift_assets").upsert(row, { onConflict: "telegram_name" }).select("id").single();
        if (assetError || !asset) throw assetError || new Error(`Could not upsert ${normalized.slug}`);
        stats.assetsUpserted += 1;

        const { data: beforeVirtual, error: virtualError } = await supabase.from("virtual_gifts").select("id").eq("asset_id", asset.id).maybeSingle();
        if (virtualError) throw virtualError;
        if (!beforeVirtual) {
          const { error: seedError } = await supabase.rpc("seed_global_catalog_gift", { p_asset_id: asset.id, p_initial_ton_price: normalized.priceTon });
          if (seedError) throw seedError;
          stats.virtualListingsCreated += 1;
          acceptedInCollection += 1;
        }
      }
    }

    if (current === 0 && stats.virtualListingsCreated === 0) {
      throw new Error(`Telegram resale catalogue had no eligible TON-priced Gifts at or below ${maxInitialPrice} TON`);
    }

    await markRun(runId, { status: "success", collections_scanned: stats.collectionsScanned, resale_gifts_seen: stats.resaleGiftsSeen, assets_upserted: stats.assetsUpserted, virtual_listings_created: stats.virtualListingsCreated, media_objects_uploaded: stats.mediaObjectsUploaded, skipped_without_ton_price: stats.skippedWithoutTonPrice, finished_at: new Date().toISOString() });
    await supabase.rpc("release_global_catalog_lock", { p_success: true, p_error: null });
    return { runId, skipped: false, reason: options.reason || "sync", ...stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Global Telegram resale sync failed";
    await markRun(runId, { status: "failed", error_message: message.slice(0, 2000), collections_scanned: stats.collectionsScanned, resale_gifts_seen: stats.resaleGiftsSeen, assets_upserted: stats.assetsUpserted, virtual_listings_created: stats.virtualListingsCreated, media_objects_uploaded: stats.mediaObjectsUploaded, skipped_without_ton_price: stats.skippedWithoutTonPrice, finished_at: new Date().toISOString() });
    try { await supabase.rpc("release_global_catalog_lock", { p_success: false, p_error: message }); } catch { /* lock expires automatically */ }
    throw error;
  } finally {
    if (client) await client.disconnect().catch(() => undefined);
  }
}
