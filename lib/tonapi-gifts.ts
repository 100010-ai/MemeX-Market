import { getSupabaseAdmin } from "@/lib/supabase/admin";

type JsonRecord = Record<string, unknown>;

type TonPreview = { resolution?: string; url?: string };
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
};

type ParsedItem = {
  address: string;
  collectionAddress: string;
  collectionName: string;
  name: string;
  baseName: string;
  number: number;
  telegramSlug: string | null;
  imageUrl: string;
  model: string;
  symbol: string;
  backdrop: string;
  metadata: JsonRecord;
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

// A real exported Telegram Gift collection used only as a bootstrap anchor.
// The importer still validates the live TonAPI metadata before trusting it.
const BOOTSTRAP_COLLECTIONS = [
  { address: "EQBG-g6ahkAUGWpefWbx-D_9sQ8oWbvy6puuq78U2c4NUDFS", name: "Plush Pepes" },
  { address: "EQD9ikZq6xPgKjzmdBG0G0S80RvUJjbwgHrPZXDKc_wsE84w", name: "Durov's Caps" },
  { address: "EQC4XEulxb05Le5gF6esMtDWT5XZ6tlzlMBQGNsqffxpdC5U", name: "Heart Lockets" },
  { address: "EQDRrfw5pgIC4e6NafUAx52Z9Ym6q1k26xxaXR_qx0LKJJ7D", name: "Light Swords" },
  { address: "EQCeTSJOPXP_SSvOjILY-kui4bGHUmsa-U7TXP4DjUANTl4s", name: "Jolly Chimps" },
  { address: "EQATuUGdvrjLvTWE5ppVFOVCqU2dlCLUnKTsu0n1JYm9la10", name: "Scared Cats" },
  { address: "EQCNsmpHqRSY_Dxnyh6P0MMO7zcABf8sVvG0wr245pBzO3B3", name: "Voodoo Dolls" },
  { address: "EQD6mH9bwbn6S3M_tCRWOvqAIW8M34kRwbI01niGLRPeDPsl", name: "Spy Agarics" },
  { address: "EQA4i58iuS9DUYRtUZ97sZo5mnkbiYUBpWXQOe3dEUCcP1W8", name: "Precious Peaches" },
  { address: "EQA_kx2WOydXWzYUYO1DP80aHl4yhlLGYhxjPAtRPNjMgfYM", name: "Tama Gadgets" },
  { address: "EQCyAMkb6bNyNlKPH0tJbubk1VVjASqyq9sZwkJ8AbxMkxxU", name: "Trapped Hearts" },
] as const;
const BOOTSTRAP_COLLECTION_SET = new Set<string>(BOOTSTRAP_COLLECTIONS.map((item) => item.address));
const BOOTSTRAP_COLLECTION_NAME = new Map<string, string>(BOOTSTRAP_COLLECTIONS.map((item) => [item.address, item.name]));
const TONAPI_BASE = "https://tonapi.io";
const REQUEST_TIMEOUT_MS = 8_000;

function str(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function isTelegramGiftCollection(collection: TonCollection) {
  if (!collection?.address || collection.trust === "blacklist") return false;
  const metadata = asRecord(collection.metadata) || {};
  const name = str(metadata.name);
  const description = str(metadata.description);
  const text = `${name}\n${description}`.toLowerCase();
  // These addresses are a maintained registry of real exported Telegram Gift
  // collections. Items are still validated independently before insertion.
  if (BOOTSTRAP_COLLECTION_SET.has(collection.address)) return true;
  return text.includes("telegram") && (text.includes("gift") || text.includes("collectible"));
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

function metadataImage(metadata: JsonRecord, previews?: TonPreview[]) {
  // Prefer a still image/TONAPI preview for cards. animation_url can point to
  // non-image content and previously caused perfectly valid gifts to render as
  // permanently broken <img> elements in Telegram WebView.
  for (const key of ["image", "image_url", "preview"]) {
    const value = str(metadata[key]);
    if (/^https:\/\//i.test(value)) return value;
  }
  const preview = highestPreview(previews);
  if (preview) return preview;
  for (const key of ["content_url", "animation_url"]) {
    const value = str(metadata[key]);
    if (/^https:\/\//i.test(value)) return value;
  }
  return null;
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
  const metadata = asRecord(item.metadata) || {};
  const collectionMetadata = asRecord(collection.metadata) || {};
  const collectionName = str(collectionMetadata.name || item.collection?.name);
  const itemName = str(metadata.name);
  const identity = parseGiftIdentity(itemName, collectionName, item.index);
  const imageUrl = metadataImage(metadata, item.previews);
  if (!identity || !imageUrl) return null;

  const rows = traitRows(metadata);
  const descriptionTraits = traitsFromDescription(metadata);
  const collectionSignal = isTelegramGiftCollection(collection);
  const descriptionSignal = Boolean(descriptionTraits.model && descriptionTraits.backdrop && descriptionTraits.symbol);
  if (!collectionSignal && !descriptionSignal) return null;
  const model = traitValue(rows, ["model", "appearance", "модель"]) || descriptionTraits.model;
  const symbol = traitValue(rows, ["symbol", "pattern", "icon", "символ"]) || descriptionTraits.symbol;
  const backdrop = traitValue(rows, ["backdrop", "background", "фон"]) || descriptionTraits.backdrop;
  // The fallback parser above reads the real on-chain metadata description
  // used by exported Telegram Gifts (appearance / background / icons). If the
  // indexer exposes neither structured attributes nor that description, skip.
  if (!model || !symbol || !backdrop) return null;

  return {
    address: item.address,
    collectionAddress: collection.address,
    collectionName: collectionName || identity.baseName,
    name: itemName || `${identity.baseName} #${identity.number}`,
    baseName: identity.baseName,
    number: identity.number,
    telegramSlug: findTelegramSlug(metadata),
    imageUrl,
    model,
    symbol,
    backdrop,
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

let unauthenticatedNextRequestAt = 0;
let unauthenticatedQueue = Promise.resolve();

async function respectTonApiLimit() {
  if (process.env.TONAPI_KEY?.trim()) return;
  const previous = unauthenticatedQueue;
  let release!: () => void;
  unauthenticatedQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const wait = Math.max(0, unauthenticatedNextRequestAt - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  unauthenticatedNextRequestAt = Date.now() + 4_150;
  release();
}

function retryDelay(attempt: number, retryAfter: string | null) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(1_500, Math.max(150, seconds * 1000));
  return 220 * (attempt + 1);
}

async function tonapi<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "MXM-Market/0.13" };
  const key = process.env.TONAPI_KEY?.trim();
  if (key) headers.authorization = `Bearer ${key}`;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      await respectTonApiLimit();
      const response = await fetch(`${TONAPI_BASE}${path}`, { headers, signal: controller.signal, cache: "no-store" });
      if (response.ok) return await response.json() as T;

      const transient = response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504;
      lastError = new Error(`TonAPI ${response.status} for ${path}`);
      if (!transient || attempt === 2) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt, response.headers.get("retry-after"))));
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error("TonAPI request failed");
      const transient = lastError.name === "AbortError" || /fetch|network|timeout|TonAPI (429|502|503|504)/i.test(lastError.message);
      if (!transient || attempt === 2) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt, null)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("TonAPI request failed");
}

async function upsertCollection(collection: TonCollection) {
  if (!isTelegramGiftCollection(collection)) return false;
  const metadata = asRecord(collection.metadata) || {};
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

  await supabase.from("tonapi_catalog_state").upsert({
    singleton: true,
    collection_offset: offset,
    last_discovery_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "singleton" });
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

async function importCollectionItems(collectionRow: { address: string; next_offset: number | null }, maxItems: number) {
  let offset = Math.max(0, Number(collectionRow.next_offset || 0));
  const limit = Math.max(1, Math.min(1000, maxItems));
  const payload = await tonapi<{ nft_items?: TonItem[] }>(`/v2/nfts/collections/${encodeURIComponent(collectionRow.address)}/items?limit=${limit}&offset=${offset}`);
  const rawItems = Array.isArray(payload.nft_items) ? payload.nft_items : [];
  const firstCollection = rawItems.find((item) => item.collection?.address)?.collection;
  const collection: TonCollection = {
    address: collectionRow.address,
    metadata: {
      name: firstCollection?.name || BOOTSTRAP_COLLECTION_NAME.get(collectionRow.address) || "",
      description: firstCollection?.description || "",
    },
  };
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
    model_is_animated: false,
    model_is_video: false,
    symbol_name: item.symbol,
    symbol_rarity_per_mille: perMille(parsed, "symbol", item.symbol),
    symbol_file_id: `tonapi:${item.address}:symbol`,
    symbol_thumb_file_id: null,
    symbol_is_animated: false,
    symbol_is_video: false,
    backdrop_name: item.backdrop,
    backdrop_rarity_per_mille: perMille(parsed, "backdrop", item.backdrop),
    // TonAPI gives the already-rendered NFT preview. These technical color
    // fields are not rendered for source=tonapi and therefore are not exposed
    // as Telegram trait data.
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
    model_media_url: item.imageUrl,
    symbol_media_url: null,
    chain_nft_address: item.address,
    chain_collection_address: item.collectionAddress,
    chain_verified: true,
    chain_metadata: item.metadata,
  }));

  const supabase = getSupabaseAdmin();
  let upserted = 0;
  if (rows.length) {
    // Upsert one-by-one only when a base_name + gift_number identity already
    // exists from Bot API; otherwise batch insert is substantially faster.
    const { error } = await supabase.from("gift_assets").upsert(rows, { onConflict: "telegram_name" });
    if (error) {
      for (const row of rows) {
        const existing = await supabase.from("gift_assets").select("id").eq("base_name", row.base_name).eq("gift_number", row.gift_number).maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) {
          const update = await supabase.from("gift_assets").update({
            model_media_url: row.model_media_url,
            chain_nft_address: row.chain_nft_address,
            chain_collection_address: row.chain_collection_address,
            chain_verified: true,
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

  offset += rawItems.length;
  const finished = rawItems.length < limit;
  await supabase.from("tonapi_gift_collections").update({
    next_offset: finished ? 0 : offset,
    last_synced_at: now,
    last_error: null,
    updated_at: now,
  }).eq("address", collection.address);

  return { seen: rawItems.length, upserted, skipped: rawItems.length - parsed.length };
}

async function recalculateCollectionRarity(collectionAddress: string) {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("gift_assets")
    .select("id,model_name,symbol_name,backdrop_name")
    .eq("chain_collection_address", collectionAddress)
    .eq("catalog_source", "tonapi")
    .limit(5000);
  if (result.error) throw result.error;
  const rows = (result.data || []) as Array<{ id: string; model_name: string | null; symbol_name: string | null; backdrop_name: string | null }>;
  if (!rows.length) return;

  const count = (key: "model_name" | "symbol_name" | "backdrop_name") => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const value = String(row[key] || "");
      if (value) map.set(value, (map.get(value) || 0) + 1);
    }
    return map;
  };
  const models = count("model_name");
  const symbols = count("symbol_name");
  const backdrops = count("backdrop_name");
  const rarity = (map: Map<string, number>, value: unknown) => Math.max(1, Math.min(1000, Math.round(((map.get(String(value || "")) || 1) / rows.length) * 1000)));

  for (let start = 0; start < rows.length; start += 24) {
    await Promise.all(rows.slice(start, start + 24).map(async (row) => {
      const update = await supabase.from("gift_assets").update({
        model_rarity_per_mille: rarity(models, row.model_name),
        symbol_rarity_per_mille: rarity(symbols, row.symbol_name),
        backdrop_rarity_per_mille: rarity(backdrops, row.backdrop_name),
      }).eq("id", row.id);
      if (update.error) throw update.error;
    }));
  }
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
    const collectionResult = await supabase
      .from("tonapi_gift_collections")
      .select("address,next_offset")
      .eq("active", true)
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(maxCollections);
    if (collectionResult.error) throw collectionResult.error;

    for (const row of collectionResult.data || []) {
      try {
        const imported = await importCollectionItems({ address: String(row.address), next_offset: Number(row.next_offset || 0) }, itemsPerCollection);
        collectionsProcessed += 1;
        itemsSeen += imported.seen;
        assetsUpserted += imported.upserted;
        skippedInvalid += imported.skipped;
        if (imported.upserted > 0) await recalculateCollectionRarity(String(row.address));
      } catch (error) {
        const message = error instanceof Error ? error.message : "TonAPI collection import failed";
        collectionsFailed += 1;
        if (errors.length < 5) errors.push(`${String(row.address).slice(0, 12)}…: ${message}`);
        await supabase.from("tonapi_gift_collections").update({ last_error: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("address", row.address);
      }
    }

    // Do not report a green global sync when every TonAPI collection failed.
    // That used to make the market retry the same slow bootstrap on every GET.
    if (collectionsProcessed === 0 && collectionsFailed > 0) {
      throw new Error(errors[0] || "TonAPI collection import failed");
    }
    const partialError = collectionsFailed > 0 ? `${collectionsFailed} collection(s) failed: ${errors.join(" | ")}`.slice(0, 1000) : null;
    await supabase.from("tonapi_catalog_state").upsert({ singleton: true, last_sync_at: started, last_error: partialError, updated_at: new Date().toISOString() }, { onConflict: "singleton" });
    await supabase.rpc("release_tonapi_catalog_lock");
    return { scannedCollections, discoveredCollections, collectionsProcessed, collectionsFailed, itemsSeen, assetsUpserted, skippedInvalid, source: "tonapi", ...(errors.length ? { errors } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "TonAPI sync failed";
    await supabase.from("tonapi_catalog_state").upsert({ singleton: true, last_sync_at: started, last_error: message.slice(0, 1000), updated_at: new Date().toISOString() }, { onConflict: "singleton" });
    try { await supabase.rpc("release_tonapi_catalog_lock"); } catch { /* lock expires automatically */ }
    throw error;
  }
}

export async function ensureTonApiGiftBootstrap(targetAssets = 36) {
  const supabase = getSupabaseAdmin();
  const countResult = await supabase.from("gift_assets").select("id", { head: true, count: "exact" }).in("catalog_source", ["bot_catalog", "tonapi"]).eq("is_burned", false);
  if (countResult.error) throw countResult.error;
  if ((countResult.count || 0) >= targetAssets) return { skipped: true, assets: countResult.count || 0 };

  const stateResult = await supabase.from("tonapi_catalog_state").select("last_sync_at,last_error").eq("singleton", true).maybeSingle();
  if (stateResult.error) throw stateResult.error;
  const lastAttempt = stateResult.data?.last_sync_at ? new Date(String(stateResult.data.last_sync_at)).getTime() : 0;
  // If TonAPI is temporarily unavailable, do not stall every market request.
  if (stateResult.data?.last_error && Date.now() - lastAttempt < 5 * 60_000) {
    return { skipped: true, assets: countResult.count || 0, reason: "recent-tonapi-error" };
  }

  const result = await syncTonApiGiftCatalog({ bootstrapOnly: true, maxCollections: 3, itemsPerCollection: Math.max(160, Math.ceil(targetAssets / 2)) });
  const refreshed = await supabase.from("gift_assets").select("id", { head: true, count: "exact" }).in("catalog_source", ["bot_catalog", "tonapi"]).eq("is_burned", false);
  if (refreshed.error) throw refreshed.error;
  return { skipped: false, assets: refreshed.count || 0, result };
}

