import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fragmentGiftMedia, telegramCollectibleSlug } from "@/lib/fragment-gifts";
import { tonApiGet } from "@/lib/providers/tonapi-client";

type JsonRecord = Record<string, unknown>;
type TonPreview = { resolution?: string; url?: string };
type TonPrice = {
  currency_type?: "native" | "extra_currency" | "jetton" | "fiat" | string;
  value?: string;
  decimals?: number;
  token_name?: string;
};
type TonSale = {
  address?: string;
  market?: { address?: string; name?: string };
  owner?: { address?: string; name?: string };
  price?: TonPrice;
};
type TonCollection = {
  address: string;
  next_item_index?: number;
  metadata?: JsonRecord;
  previews?: TonPreview[];
  trust?: "whitelist" | "graylist" | "blacklist" | "none" | string;
};
type TonItem = {
  address: string;
  index?: number;
  verified?: boolean;
  metadata?: JsonRecord;
  previews?: TonPreview[];
  trust?: "whitelist" | "graylist" | "blacklist" | "none" | string;
  owner?: { address?: string; is_scam?: boolean };
  collection?: { address?: string; name?: string; description?: string };
  sale?: TonSale;
};
type MediaKind = "static" | "animated" | "video";
type ParsedItem = {
  address: string;
  collectionAddress: string;
  collectionName: string;
  name: string;
  baseName: string;
  number: number;
  telegramSlug: string | null;
  mediaUrl: string;
  previewUrl: string;
  mediaKind: MediaKind;
  resalePriceTon: number | null;
  model: string;
  symbol: string;
  backdrop: string;
  chainVerified: boolean;
  metadata: JsonRecord;
};
type CollectionRow = {
  address: string;
  next_offset: number | null;
  name?: string | null;
  description?: string | null;
};

export type TonApiGiftSyncResult = {
  scannedCollections: number;
  discoveredCollections: number;
  collectionsProcessed: number;
  collectionsFailed: number;
  itemsSeen: number;
  assetsUpserted: number;
  skippedInvalid: number;
  source: "tonapi";
  skipped?: boolean;
  errors?: string[];
};

// Canonical raw workchain addresses. Friendly EQ aliases encode the same accounts,
// but using both representations in the catalogue created duplicate collection rows.
const BOOTSTRAP_COLLECTIONS = [
  { address: "0:46fa0e9a864014196a5e7d66f1f83ffdb10f2859bbf2ea9baeabbf14d9ce0d50", name: "Plush Pepes" },
  { address: "0:fd8a466aeb13e02a3ce67411b41b44bcd11bd42636f0807acf6570ca73fc2c13", name: "Durov's Caps" },
  { address: "0:b85c4ba5c5bd392dee6017a7ac32d0d64f95d9ead97394c05018db2a7dfc6974", name: "Heart Lockets" },
  { address: "0:d1adfc39a60202e1ee8d69f500c79d99f589baab5936eb1c5a5d1feac742ca24", name: "Light Swords" },
  { address: "0:9e4d224e3d73ff492bce8c82d8fa4ba2e1b187526b1af94ed35cfe038d400d4e", name: "Jolly Chimps" },
  { address: "0:13b9419dbeb8cbbd3584e69a5514e542a94d9d9422d49ca4ecbb49f52589bd95", name: "Scared Cats" },
  { address: "0:8db26a47a91498fc3c67ca1e8fd0c30eef370005ff2c56f1b4c2bdb8e690733b", name: "Voodoo Dolls" },
  { address: "0:fa987f5bc1b9fa4b733fb424563afa80216f0cdf8911c1b234d678862d13de0c", name: "Spy Agarics" },
  { address: "0:388b9f22b92f4351846d519f7bb19a399a791b898501a565d039eddd11409c3f", name: "Precious Peaches" },
  { address: "0:3f931d963b27575b361460ed433fcd1a1e5e328652c6621c633c0b513cd8cc81", name: "Tama Gadgets" },
  { address: "0:b200c91be9b37236528f1f4b496ee6e4d55563012ab2abdb19c2427c01bc4c93", name: "Trapped Hearts" },
] as const;
const BOOTSTRAP_COLLECTION_SET = new Set<string>(BOOTSTRAP_COLLECTIONS.map((item) => item.address));
const BOOTSTRAP_COLLECTION_NAME = new Map<string, string>(BOOTSTRAP_COLLECTIONS.map((item) => [item.address, item.name]));
const BOOTSTRAP_NAME_ADDRESS = new Map<string, string>(BOOTSTRAP_COLLECTIONS.map((item) => [normalizeCollectionName(item.name), item.address]));
const EXPLICIT_REJECTED_COLLECTIONS = new Set<string>([
  // Third-party HeadNFTs/OnlyGames collection that advertises future Telegram
  // conversion/status integration, not an official Telegram collectible.
  "0:4b1448be92504e94173494c164f267aeabfde5e40ec8b367028d2d153604a139",
]);

function str(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function normalizeCollectionName(value: unknown) {
  return str(value).toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");
}

function collectionMetadata(collection: TonCollection) {
  return asRecord(collection.metadata) || {};
}

function hasNegativeCollectionSignal(collection: TonCollection) {
  if (!collection?.address || EXPLICIT_REJECTED_COLLECTIONS.has(collection.address) || collection.trust === "blacklist") return true;
  const metadata = collectionMetadata(collection);
  const name = str(metadata.name);
  const description = str(metadata.description);
  const text = `${name}\n${description}`.toLowerCase();
  if (name.toLowerCase().includes("[staging]")) return true;
  return /(hope.{0,120}soon|will be able to|convert.{0,160}(telegram )?gifts?|tribute to telegram gifts?|inspired by telegram.{0,80}gifts?|for our app.{0,120}(telegram|status)|our application.{0,120}(telegram|status))/i.test(text);
}

function canonicalNameMatchesAddress(collection: TonCollection) {
  const metadata = collectionMetadata(collection);
  const name = normalizeCollectionName(metadata.name);
  const canonical = BOOTSTRAP_NAME_ADDRESS.get(name);
  return !canonical || canonical === collection.address;
}

function hasTelegramGiftText(collection: TonCollection) {
  const metadata = collectionMetadata(collection);
  const text = `${str(metadata.name)}\n${str(metadata.description)}`.toLowerCase();
  return text.includes("telegram") && (text.includes("gift") || text.includes("collectible"));
}

// Existing active rows are still allowed to refresh when their metadata passes the
// rejection/canonical guards. This avoids suddenly deleting legitimate special
// collections that predate the stronger discovery policy.
function isImportableCollection(collection: TonCollection) {
  if (!collection?.address || hasNegativeCollectionSignal(collection) || !canonicalNameMatchesAddress(collection)) return false;
  if (BOOTSTRAP_COLLECTION_SET.has(collection.address)) return true;
  return hasTelegramGiftText(collection);
}

// New automatic discovery is intentionally stricter than legacy refresh. Free-text
// metadata is forgeable; a non-bootstrap collection must also be TonAPI-whitelisted.
function isDiscoveryCandidate(collection: TonCollection) {
  if (!isImportableCollection(collection)) return false;
  if (BOOTSTRAP_COLLECTION_SET.has(collection.address)) return true;
  return collection.trust === "whitelist";
}

function highestPreview(previews: TonPreview[] | undefined) {
  const items = (previews || []).filter((item) => typeof item?.url === "string" && item.url.length > 0);
  if (!items.length) return null;
  const score = (resolution: string | undefined) => {
    const match = String(resolution || "").match(/(\d+)x(\d+)/i);
    return match ? Number(match[1]) * Number(match[2]) : 0;
  };
  return [...items].sort((a, b) => score(b.resolution) - score(a.resolution))[0]?.url || null;
}

function normalizeMediaUrl(value: unknown) {
  const raw = str(value);
  if (/^https:\/\//i.test(raw)) return raw;
  if (/^ipfs:\/\//i.test(raw)) return `https://ipfs.io/ipfs/${raw.replace(/^ipfs:\/\//i, "").replace(/^ipfs\//i, "")}`;
  return null;
}

function metadataPreview(metadata: JsonRecord, previews?: TonPreview[]) {
  for (const key of ["image", "image_url", "preview", "thumbnail", "thumbnail_url"]) {
    const value = normalizeMediaUrl(metadata[key]);
    if (value) return value;
  }
  return highestPreview(previews);
}

function mediaKindFrom(metadata: JsonRecord, url: string): MediaKind {
  const hint = [metadata.animation_type, metadata.content_type, metadata.mime_type, metadata.mime, metadata.type]
    .map((value) => str(value).toLowerCase())
    .filter(Boolean)
    .join(" ");
  const clean = url.split("?")[0].toLowerCase();
  if (/video\/(mp4|webm|quicktime|ogg)/.test(hint) || /\.(mp4|webm|mov|m4v|ogv)$/.test(clean)) return "video";
  if (/lottie|tgsticker|application\/json/.test(hint) || /\.(json|tgs)$/.test(clean)) return "animated";
  return "static";
}

function metadataMedia(metadata: JsonRecord, previews?: TonPreview[]) {
  const previewUrl = metadataPreview(metadata, previews);
  for (const key of ["animation_url", "animation", "video_url", "video", "content_url"]) {
    const value = normalizeMediaUrl(metadata[key]);
    if (!value) continue;
    return { mediaUrl: value, previewUrl: previewUrl || value, mediaKind: mediaKindFrom(metadata, value) };
  }
  if (!previewUrl) return null;
  return { mediaUrl: previewUrl, previewUrl, mediaKind: "static" as const };
}

function nativeTonSalePrice(sale: TonSale | undefined) {
  const price = sale?.price;
  if (!price || price.currency_type !== "native") return null;
  const raw = str(price.value);
  const decimals = Number(price.decimals);
  if (!/^\d+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
  const value = Number(raw) / (10 ** decimals);
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return null;
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function traitRows(metadata: JsonRecord) {
  const raw = metadata.attributes;
  if (!Array.isArray(raw)) return [] as Array<{ key: string; value: string }>;
  const rows: Array<{ key: string; value: string }> = [];
  for (const entry of raw) {
    const row = asRecord(entry);
    if (!row) continue;
    const key = str(row.trait_type || row.type || row.key || row.name).toLowerCase();
    const value = str(row.value || row.val || row.text);
    if (key && value) rows.push({ key, value });
  }
  return rows;
}

function traitValue(rows: Array<{ key: string; value: string }>, names: string[]) {
  for (const row of rows) {
    if (names.some((name) => row.key === name || row.key.includes(name))) return row.value;
  }
  return "";
}

function traitsFromDescription(metadata: JsonRecord) {
  const description = str(metadata.description);
  const patterns = [
    /with the appearance\s+(.+?)\s+on an?\s+(.+?)\s+background\s+with\s+(.+?)\s+icons?\b/i,
    /appearance[:\s]+(.+?)[,;]\s*(?:backdrop|background)[:\s]+(.+?)[,;]\s*(?:symbol|icons?)[:\s]+(.+?)(?:[.;]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) return { model: match[1].trim(), backdrop: match[2].trim(), symbol: match[3].trim() };
  }
  return { model: "", backdrop: "", symbol: "" };
}

function singularCollectionName(value: string) {
  const clean = value.replace(/\s+NFTs?$/i, "").trim();
  if (/ies$/i.test(clean)) return `${clean.slice(0, -3)}y`;
  if (/(ches|shes|xes|zes)$/i.test(clean)) return clean.slice(0, -2);
  if (/sses$/i.test(clean)) return clean.slice(0, -2);
  if (/s$/i.test(clean) && !/ss$/i.test(clean)) return clean.slice(0, -1);
  return clean;
}

function findTelegramSlug(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") {
    const match = value.match(/(?:https?:\/\/)?t\.me\/nft\/([A-Za-z0-9_-]{3,160})/i);
    return match?.[1] || null;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findTelegramSlug(child, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const child of Object.values(value as JsonRecord)) {
      const found = findTelegramSlug(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function parseGiftIdentity(itemName: string, collectionName: string, index: number | undefined) {
  const cleaned = itemName.replace(/^Fragment\s*#\d+\s*[—-]\s*/i, "").trim();
  const match = cleaned.match(/^(.*?)\s*#\s*(\d+)\s*$/);
  if (match) {
    const base = match[1].trim();
    const number = Number(match[2]);
    if (base && Number.isSafeInteger(number) && number > 0) return { baseName: base, number };
  }
  const fallbackNumber = Number(index);
  if (collectionName && Number.isSafeInteger(fallbackNumber) && fallbackNumber > 0) {
    const baseName = singularCollectionName(collectionName);
    if (baseName) return { baseName, number: fallbackNumber };
  }
  return null;
}

function isBurnedOwner(address: unknown) {
  const value = str(address).toLowerCase();
  if (!value) return false;
  return value === "0:0000000000000000000000000000000000000000000000000000000000000000"
    || value === "eqaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaam9c"
    || value === "uqaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaajkz";
}

function parseTonItem(item: TonItem, collection: TonCollection): ParsedItem | null {
  if (!item?.address || item.trust === "blacklist" || item.verified === false || isBurnedOwner(item.owner?.address)) return null;
  if (!isImportableCollection(collection)) return null;
  const metadata = asRecord(item.metadata) || {};
  const collectionMeta = collectionMetadata(collection);
  const collectionName = str(collectionMeta.name || item.collection?.name);
  const itemName = str(metadata.name);
  const identity = parseGiftIdentity(itemName, collectionName, item.index);
  const tonApiMedia = metadataMedia(metadata, item.previews);
  if (!identity || !tonApiMedia) return null;

  const rows = traitRows(metadata);
  const descriptionTraits = traitsFromDescription(metadata);
  const model = traitValue(rows, ["model", "appearance", "модель"]) || descriptionTraits.model;
  const symbol = traitValue(rows, ["symbol", "pattern", "icon", "символ"]) || descriptionTraits.symbol;
  const backdrop = traitValue(rows, ["backdrop", "background", "фон"]) || descriptionTraits.backdrop;
  if (!model || !symbol || !backdrop) return null;

  const telegramSlug = findTelegramSlug(metadata) || telegramCollectibleSlug(null, identity.baseName, identity.number);
  const fragmentMedia = telegramSlug ? fragmentGiftMedia(telegramSlug) : null;
  return {
    address: item.address,
    collectionAddress: collection.address,
    collectionName: collectionName || identity.baseName,
    name: itemName || `${identity.baseName} #${identity.number}`,
    baseName: identity.baseName,
    number: identity.number,
    telegramSlug,
    mediaUrl: fragmentMedia?.animation || tonApiMedia.mediaUrl,
    previewUrl: fragmentMedia?.large || tonApiMedia.previewUrl,
    mediaKind: fragmentMedia ? "animated" : tonApiMedia.mediaKind,
    resalePriceTon: nativeTonSalePrice(item.sale),
    model,
    symbol,
    backdrop,
    chainVerified: item.verified === true,
    metadata,
  };
}

function perMille(items: ParsedItem[], key: "model" | "symbol" | "backdrop", value: string) {
  if (!items.length) return 1000;
  const count = items.reduce((sum, item) => sum + (item[key] === value ? 1 : 0), 0);
  return Math.max(1, Math.min(1000, Math.round((count / items.length) * 1000)));
}

function sourceIdentity(item: ParsedItem) {
  return item.telegramSlug || `ton:${item.address}`;
}

async function tonapi<T>(path: string): Promise<T> {
  return tonApiGet<T>(path, { cacheTtlMs: path.includes("/items?") ? 12_000 : 60_000, allowStaleOnFailure: true });
}

async function rejectCollection(address: string, reason: string) {
  const supabase = getSupabaseAdmin();
  const rejected = await supabase.from("tonapi_gift_collection_rejections_v221").upsert({
    address,
    reason: reason.slice(0, 1000),
    updated_at: new Date().toISOString(),
  }, { onConflict: "address" });
  if (rejected.error) throw rejected.error;
}

async function upsertCollection(collection: TonCollection) {
  if (!isDiscoveryCandidate(collection)) return false;
  const metadata = collectionMetadata(collection);
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("tonapi_gift_collections").upsert({
    address: collection.address,
    name: str(metadata.name) || collection.address,
    description: str(metadata.description) || null,
    total_hint: Number.isFinite(Number(collection.next_item_index)) ? Number(collection.next_item_index) : null,
    verified_at: new Date().toISOString(),
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "address" });
  if (error) throw error;
  return true;
}

export async function discoverTonApiGiftCollections(options: { pages?: number; pageSize?: number } = {}) {
  const pages = Math.max(1, Math.min(8, Math.floor(options.pages ?? 2)));
  const pageSize = Math.max(50, Math.min(1000, Math.floor(options.pageSize ?? 500)));
  const supabase = getSupabaseAdmin();
  const stateResult = await supabase.from("tonapi_catalog_state").select("collection_offset").eq("singleton", true).maybeSingle();
  if (stateResult.error) throw stateResult.error;
  let offset = Number(stateResult.data?.collection_offset || 0);
  let scanned = 0;
  let discovered = 0;

  for (let page = 0; page < pages; page += 1) {
    const payload = await tonapi<{ nft_collections?: TonCollection[] }>(`/v2/nfts/collections?limit=${pageSize}&offset=${offset}`);
    const rows = Array.isArray(payload.nft_collections) ? payload.nft_collections : [];
    scanned += rows.length;
    for (const collection of rows) {
      if (await upsertCollection(collection)) discovered += 1;
    }
    offset += rows.length;
    if (rows.length < pageSize) offset = 0;
    if (!rows.length) break;
  }

  const stateUpdate = await supabase.from("tonapi_catalog_state").upsert({
    singleton: true,
    collection_offset: offset,
    last_discovery_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "singleton" });
  if (stateUpdate.error) throw stateUpdate.error;
  return { scanned, discovered };
}

async function ensureBootstrapCollections(limit: number = BOOTSTRAP_COLLECTIONS.length) {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const rows = BOOTSTRAP_COLLECTIONS.slice(0, Math.max(1, Math.min(BOOTSTRAP_COLLECTIONS.length, limit))).map((item) => ({
    address: item.address,
    name: item.name,
    description: null,
    verified_at: now,
    active: true,
    updated_at: now,
  }));
  const { error } = await supabase.from("tonapi_gift_collections").upsert(rows, { onConflict: "address" });
  if (error) throw error;
  return rows.length;
}

function collectionFromRowAndItems(collectionRow: CollectionRow, rawItems: TonItem[]): TonCollection {
  const firstCollection = rawItems.find((item) => item.collection?.address)?.collection;
  return {
    address: collectionRow.address,
    metadata: {
      name: firstCollection?.name || collectionRow.name || BOOTSTRAP_COLLECTION_NAME.get(collectionRow.address) || "",
      description: firstCollection?.description || collectionRow.description || "",
    },
  };
}

async function importCollectionItems(collectionRow: CollectionRow, maxItems: number) {
  let offset = Math.max(0, Number(collectionRow.next_offset || 0));
  const limit = Math.max(1, Math.min(1000, maxItems));
  const payload = await tonapi<{ nft_items?: TonItem[] }>(`/v2/nfts/collections/${encodeURIComponent(collectionRow.address)}/items?limit=${limit}&offset=${offset}`);
  const rawItems = Array.isArray(payload.nft_items) ? payload.nft_items : [];
  const collection = collectionFromRowAndItems(collectionRow, rawItems);

  if (!isImportableCollection(collection)) {
    await rejectCollection(collectionRow.address, "Rejected by source-side Telegram Gift validation");
    return { seen: rawItems.length, upserted: 0, skipped: rawItems.length };
  }

  const parsed = rawItems.map((item) => parseTonItem(item, collection)).filter((item): item is ParsedItem => Boolean(item));
  const now = new Date().toISOString();
  const rows = parsed.map((item) => ({
    telegram_name: sourceIdentity(item),
    gift_id: null,
    base_name: item.baseName,
    gift_number: item.number,
    model_name: item.model,
    model_rarity_per_mille: perMille(parsed, "model", item.model),
    model_rarity: null,
    model_file_id: `tonapi:${item.address}:model`,
    model_thumb_file_id: null,
    model_is_animated: item.mediaKind === "animated",
    model_is_video: item.mediaKind === "video",
    symbol_name: item.symbol,
    symbol_rarity_per_mille: perMille(parsed, "symbol", item.symbol),
    symbol_file_id: `tonapi:${item.address}:symbol`,
    symbol_thumb_file_id: null,
    symbol_is_animated: false,
    symbol_is_video: false,
    backdrop_name: item.backdrop,
    backdrop_rarity_per_mille: perMille(parsed, "backdrop", item.backdrop),
    backdrop_center_color: 0,
    backdrop_edge_color: 0,
    backdrop_symbol_color: 0,
    backdrop_text_color: 0xffffff,
    is_premium: false,
    is_burned: false,
    is_from_blockchain: true,
    telegram_payload: item.metadata,
    last_seen_at: now,
    updated_at: now,
    catalog_source: "tonapi",
    source_reference: `tonapi:${item.collectionAddress}`,
    telegram_resale_price_ton: item.resalePriceTon,
    resale_seen_at: item.resalePriceTon == null ? null : now,
    model_media_url: item.mediaUrl,
    model_preview_url: item.previewUrl,
    symbol_media_url: null,
    chain_nft_address: item.address,
    chain_collection_address: item.collectionAddress,
    chain_verified: item.chainVerified,
    chain_metadata: item.metadata,
  }));

  const supabase = getSupabaseAdmin();
  let upserted = 0;
  if (rows.length) {
    const { error } = await supabase.from("gift_assets").upsert(rows, { onConflict: "telegram_name" });
    if (error) {
      for (const row of rows) {
        const existing = await supabase.from("gift_assets").select("id,catalog_source").eq("base_name", row.base_name).eq("gift_number", row.gift_number).maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) {
          const preserveTelegramMedia = existing.data.catalog_source !== "tonapi";
          const update = await supabase.from("gift_assets").update({
            ...(!preserveTelegramMedia ? {
              model_is_animated: row.model_is_animated,
              model_is_video: row.model_is_video,
              model_media_url: row.model_media_url,
            } : {}),
            model_preview_url: row.model_preview_url,
            telegram_resale_price_ton: row.telegram_resale_price_ton,
            resale_seen_at: row.resale_seen_at,
            chain_nft_address: row.chain_nft_address,
            chain_collection_address: row.chain_collection_address,
            chain_verified: row.chain_verified,
            chain_metadata: row.chain_metadata,
            is_from_blockchain: true,
            last_seen_at: now,
            updated_at: now,
          }).eq("id", existing.data.id);
          if (update.error) throw update.error;
          upserted += 1;
        } else {
          const insert = await supabase.from("gift_assets").insert(row);
          if (insert.error) throw insert.error;
          upserted += 1;
        }
      }
    } else {
      upserted = rows.length;
    }
  }

  const priced = parsed.filter((item) => item.resalePriceTon != null && item.resalePriceTon > 0);
  if (priced.length) {
    const assetLookup = await supabase
      .from("gift_assets")
      .select("id,chain_nft_address,base_name")
      .in("chain_nft_address", priced.map((item) => item.address));
    if (assetLookup.error) throw assetLookup.error;
    const assetRows = (assetLookup.data || []) as Array<{ id: string; chain_nft_address: string | null; base_name: string | null }>;
    const byAddress = new Map(assetRows.map((row) => [String(row.chain_nft_address), row]));
    const recentCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
    const assetIds = assetRows.map((asset) => String(asset.id));
    const recentResult = assetIds.length
      ? await supabase.from("gift_price_observations").select("asset_id,price_ton,observed_at")
        .in("asset_id", assetIds).eq("source", "tonapi").eq("kind", "listing")
        .gte("observed_at", recentCutoff).order("observed_at", { ascending: false })
      : { data: [], error: null };
    if (recentResult.error) throw recentResult.error;
    const recentPrice = new Map<string, number>();
    for (const row of recentResult.data || []) {
      const assetId = String(row.asset_id || "");
      if (!assetId || recentPrice.has(assetId)) continue;
      const value = Number(row.price_ton);
      if (Number.isFinite(value) && value > 0) recentPrice.set(assetId, value);
    }
    const observations = priced.flatMap((item) => {
      const asset = byAddress.get(item.address);
      if (!asset || item.resalePriceTon == null) return [];
      const assetId = String(asset.id);
      const previous = recentPrice.get(assetId);
      if (previous != null && Math.abs(previous - item.resalePriceTon) < 1e-9) return [];
      return [{
        asset_id: asset.id,
        base_name: String(asset.base_name || item.baseName),
        source: "tonapi",
        kind: "listing",
        currency: "TON",
        price_ton: item.resalePriceTon,
        source_ref: item.address,
        observed_at: now,
      }];
    });
    if (observations.length) {
      const observationResult = await supabase.from("gift_price_observations").insert(observations);
      if (observationResult.error) throw observationResult.error;
    }
  }

  offset += rawItems.length;
  const finished = rawItems.length < limit;
  const collectionState = await supabase.from("tonapi_gift_collections").update({
    next_offset: finished ? 0 : offset,
    last_synced_at: now,
    last_error: null,
    updated_at: now,
  }).eq("address", collection.address);
  if (collectionState.error) throw collectionState.error;
  return { seen: rawItems.length, upserted, skipped: rawItems.length - parsed.length };
}

async function recalculateCollectionRarity(collectionAddress: string) {
  const result = await getSupabaseAdmin().rpc("recalculate_tonapi_collection_rarity_v040", { p_collection_address: collectionAddress });
  if (result.error) throw result.error;
}

export async function syncTonApiGiftCatalog(options: { discoverPages?: number; maxCollections?: number; itemsPerCollection?: number; bootstrapOnly?: boolean } = {}): Promise<TonApiGiftSyncResult> {
  const supabase = getSupabaseAdmin();
  const started = new Date().toISOString();
  const lock = await supabase.rpc("acquire_tonapi_catalog_lock", { p_seconds: options.bootstrapOnly ? 60 : 120 });
  if (lock.error) throw lock.error;
  if (lock.data !== true) return { scannedCollections: 0, discoveredCollections: 0, collectionsProcessed: 0, collectionsFailed: 0, itemsSeen: 0, assetsUpserted: 0, skippedInvalid: 0, source: "tonapi", skipped: true };
  let scannedCollections = 0;
  let discoveredCollections = 0;
  let collectionsProcessed = 0;
  let collectionsFailed = 0;
  let itemsSeen = 0;
  let assetsUpserted = 0;
  let skippedInvalid = 0;
  const errors: string[] = [];

  try {
    discoveredCollections += await ensureBootstrapCollections(options.bootstrapOnly ? 6 : BOOTSTRAP_COLLECTIONS.length);
    if (!options.bootstrapOnly) {
      const discovery = await discoverTonApiGiftCollections({ pages: options.discoverPages ?? (process.env.TONAPI_KEY?.trim() ? 2 : 1), pageSize: process.env.TONAPI_KEY?.trim() ? 500 : 250 });
      scannedCollections += discovery.scanned;
      discoveredCollections += discovery.discovered;
    }

    const maxCollections = Math.max(1, Math.min(24, Math.floor(options.maxCollections ?? (options.bootstrapOnly ? 3 : (process.env.TONAPI_KEY?.trim() ? 10 : 6)))));
    const itemsPerCollection = Math.max(8, Math.min(1000, Math.floor(options.itemsPerCollection ?? (options.bootstrapOnly ? 160 : 300))));
    const collectionResult = await supabase.from("tonapi_gift_collections")
      .select("address,next_offset,name,description")
      .eq("active", true)
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(maxCollections);
    if (collectionResult.error) throw collectionResult.error;

    for (const row of collectionResult.data || []) {
      try {
        const imported = await importCollectionItems({
          address: String(row.address),
          next_offset: Number(row.next_offset || 0),
          name: row.name == null ? null : String(row.name),
          description: row.description == null ? null : String(row.description),
        }, itemsPerCollection);
        collectionsProcessed += 1;
        itemsSeen += imported.seen;
        assetsUpserted += imported.upserted;
        skippedInvalid += imported.skipped;
        if (imported.upserted > 0) await recalculateCollectionRarity(String(row.address));
      } catch (error) {
        const message = error instanceof Error ? error.message : "TonAPI collection import failed";
        collectionsFailed += 1;
        if (errors.length < 5) errors.push(`${String(row.address).slice(0, 12)}…: ${message}`);
        const failureState = await supabase.from("tonapi_gift_collections").update({ last_error: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("address", row.address);
        if (failureState.error) throw failureState.error;
      }
    }

    if (collectionsProcessed === 0 && collectionsFailed > 0) throw new Error(errors[0] || "TonAPI collection import failed");
    const partialError = collectionsFailed > 0 ? `${collectionsFailed} collection(s) failed: ${errors.join(" | ")}`.slice(0, 1000) : null;
    const syncState = await supabase.from("tonapi_catalog_state").upsert({ singleton: true, last_sync_at: started, last_error: partialError, updated_at: new Date().toISOString() }, { onConflict: "singleton" });
    if (syncState.error) throw syncState.error;
    const release = await supabase.rpc("release_tonapi_catalog_lock");
    if (release.error) throw release.error;
    return { scannedCollections, discoveredCollections, collectionsProcessed, collectionsFailed, itemsSeen, assetsUpserted, skippedInvalid, source: "tonapi", ...(errors.length ? { errors } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "TonAPI sync failed";
    const failureState = await supabase.from("tonapi_catalog_state").upsert({ singleton: true, last_sync_at: started, last_error: message.slice(0, 1000), updated_at: new Date().toISOString() }, { onConflict: "singleton" });
    if (failureState.error) console.error("tonapi sync failure state", failureState.error);
    const release = await supabase.rpc("release_tonapi_catalog_lock");
    if (release.error) console.error("tonapi catalog lock release", release.error);
    throw error;
  }
}

export async function ensureTonApiGiftBootstrap(targetAssets = 36) {
  const supabase = getSupabaseAdmin();
  const countResult = await supabase.from("gift_assets").select("id", { head: true, count: "exact" }).in("catalog_source", ["bot_catalog", "tonapi"]).eq("is_burned", false).not("telegram_resale_price_ton", "is", null);
  if (countResult.error) throw countResult.error;
  if ((countResult.count || 0) >= targetAssets) return { skipped: true, assets: countResult.count || 0 };

  const stateResult = await supabase.from("tonapi_catalog_state").select("last_sync_at,last_error").eq("singleton", true).maybeSingle();
  if (stateResult.error) throw stateResult.error;
  const lastAttempt = stateResult.data?.last_sync_at ? new Date(String(stateResult.data.last_sync_at)).getTime() : 0;
  if (stateResult.data?.last_error && Date.now() - lastAttempt < 5 * 60_000) {
    return { skipped: true, assets: countResult.count || 0, reason: "recent-tonapi-error" };
  }

  const result = await syncTonApiGiftCatalog({ bootstrapOnly: true, maxCollections: 3, itemsPerCollection: Math.max(160, Math.ceil(targetAssets / 2)) });
  const refreshed = await supabase.from("gift_assets").select("id", { head: true, count: "exact" }).in("catalog_source", ["bot_catalog", "tonapi"]).eq("is_burned", false).not("telegram_resale_price_ton", "is", null);
  if (refreshed.error) throw refreshed.error;
  return { skipped: false, assets: refreshed.count || 0, result };
}
