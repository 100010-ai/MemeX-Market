import { rgbIntToHex } from "@/lib/format";
import type { Coin, GiftAsset, GiftCollection, GiftMediaKind } from "@/lib/types";

function requiredString(value: unknown, _name: string, fallback = "") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stringValue(value: unknown, _name: string, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function requiredNumber(value: unknown, _name: string, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableString(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function safeIsoDate(value: unknown, fallback: string | null = null) {
  if (typeof value !== "string" && !(value instanceof Date)) return fallback;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function nullableNumber(value: unknown, name: string) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeColor(value: unknown, fallback = 16777215) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeMediaUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url || /^tonapi:.*:symbol$/i.test(url) || /^tonapi:/i.test(url)) return null;
  if (/^(?:https?:\/\/|data:image\/|\/api\/)/i.test(url)) return url;
  return null;
}

function safeImageMediaUrl(value: unknown) {
  const url = safeMediaUrl(value);
  if (!url) return null;

  // Lottie/Telegram animations and video URLs are valid media, but they are
  // not valid <img> sources. Keeping them out of the canonical preview field
  // prevents a failed preview from degrading into a browser broken-image icon.
  if (/\.(?:json|tgs|mp4|webm|mov|m4v|ogv)(?:$|[?#])/i.test(url)) return null;
  return url;
}

function telegramFileUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const fileId = value.trim();
  if (!fileId || /^tonapi:/i.test(fileId)) return null;
  return `/api/telegram/file/${encodeURIComponent(fileId)}`;
}

/** Canonical Gift image contract used by every API mapper. */
export function resolveGiftImageUrl(row: Record<string, unknown>) {
  const modelIsStatic = row.model_is_animated !== true && row.model_is_video !== true;
  const symbolIsStatic = row.symbol_is_animated !== true && row.symbol_is_video !== true;

  return safeImageMediaUrl(row.model_preview_url)
    || (modelIsStatic ? safeImageMediaUrl(row.model_media_url) : null)
    || (symbolIsStatic ? safeImageMediaUrl(row.symbol_media_url) : null)
    || telegramFileUrl(row.model_thumb_file_id)
    || (modelIsStatic ? telegramFileUrl(row.model_file_id) : null)
    || telegramFileUrl(row.symbol_thumb_file_id)
    || (symbolIsStatic ? telegramFileUrl(row.symbol_file_id) : null);
}

function mediaKind(animated: unknown, video: unknown, _label: string): GiftMediaKind {
  if (animated === true && video === true) return "animated";
  if (video === true) return "video";
  if (animated === true) return "animated";

  // Telegram/TON API catalog entries can omit media flags.
  // Missing flags do not mean invalid media; treat them as static.
  if ((video == null || video === false) && (animated == null || animated === false)) {
    return "static";
  }

  return "static";
}

// Keep this as a string literal, not Array.join(). Supabase's type-level SelectQueryError
// parser can only infer selected columns from a literal. A widened `string` makes query
// rows become GenericStringError during `next build` type checking.
export const giftMarketSelect = "asset_id,virtual_gift_id,telegram_name,gift_id,base_name,gift_number,model_name,model_rarity_per_mille,model_rarity,model_file_id,model_thumb_file_id,model_is_animated,model_is_video,symbol_name,symbol_rarity_per_mille,symbol_file_id,symbol_thumb_file_id,symbol_is_animated,symbol_is_video,backdrop_name,backdrop_rarity_per_mille,backdrop_center_color,backdrop_edge_color,backdrop_symbol_color,backdrop_text_color,is_premium,is_from_blockchain,is_burned,last_seen_at,owner_profile_id,owner_name,acquired_price,listing_price,last_sale_price,status,created_at,estimated_value,best_offer,offer_count,catalog_source,model_media_url,symbol_media_url,model_preview_url,chain_nft_address,chain_collection_address,chain_verified,listed_at,listing_updated_at,listing_expires_at,external_listing_price_ton,external_price_source,external_price_seen_at,reference_price_ton,price_basis,collection_floor,model_floor,backdrop_floor,symbol_floor" as const;

export function mapCoin(row: Record<string, unknown>): Coin {
  return {
    id: requiredString(row.id, "coin id"),
    creatorId: nullableString(row.creator_profile_id),
    name: requiredString(row.name, "coin name", "Мемкоин"),
    symbol: requiredString(row.symbol, "coin symbol", "—"),
    imageUrl: safeMediaUrl(row.image_url),
    description: stringValue(row.description, "coin description"),
    currentPrice: requiredNumber(row.current_price, "coin current price"),
    marketCap: requiredNumber(row.market_cap, "coin market cap"),
    volume24h: requiredNumber(row.volume_24h, "coin 24h volume"),
    change24h: requiredNumber(row.change_24h, "coin 24h change"),
    holderCount: requiredNumber(row.holder_count, "coin holder count"),
    tradeCount24h: requiredNumber(row.trade_count_24h, "coin trade count"),
    createdAt: safeIsoDate(row.created_at, new Date(0).toISOString()) || new Date(0).toISOString(),
    creatorName: nullableString(row.creator_name),
    liquidity: requiredNumber(row.liquidity, "coin liquidity"),
    allTimeVolume: requiredNumber(row.all_time_volume, "coin all-time volume"),
    athPrice: requiredNumber(row.ath_price, "coin ATH"),
    buyVolume24h: requiredNumber(row.buy_volume_24h, "coin 24h buy volume"),
    sellVolume24h: requiredNumber(row.sell_volume_24h, "coin 24h sell volume"),
    totalSupply: requiredNumber(row.total_supply, "coin total supply"),
    tokenReserve: requiredNumber(row.token_reserve, "coin token reserve"),
    quoteReserve: requiredNumber(row.quote_reserve, "coin quote reserve"),
  };
}

export function mapGift(row: Record<string, unknown>): GiftAsset {
  const status = row.status;
  const safeStatus = status === "owned" || status === "listed" ? status : "owned";

  return {
    id: requiredString(row.asset_id, "gift asset id"),
    virtualGiftId: requiredString(row.virtual_gift_id, "virtual gift id"),
    telegramName: requiredString(row.telegram_name, "Telegram gift name", requiredString(row.base_name, "gift base name", "Подарок")),
    giftId: nullableString(row.gift_id),
    baseName: requiredString(row.base_name, "gift base name", "Подарок"),
    number: requiredNumber(row.gift_number, "gift number"),
    modelName: nullableString(row.model_name) || "Неизвестная модель",
    modelRarityPerMille: requiredNumber(row.model_rarity_per_mille, "model rarity"),
    modelRarity: nullableString(row.model_rarity),
    symbolName: nullableString(row.symbol_name) || "Неизвестный символ",
    symbolRarityPerMille: requiredNumber(row.symbol_rarity_per_mille, "symbol rarity"),
    backdropName: nullableString(row.backdrop_name) || "Неизвестный фон",
    backdropRarityPerMille: requiredNumber(row.backdrop_rarity_per_mille, "backdrop rarity"),
    backdropCenter: rgbIntToHex(safeColor(row.backdrop_center_color)),
    backdropEdge: rgbIntToHex(safeColor(row.backdrop_edge_color)),
    backdropSymbol: rgbIntToHex(safeColor(row.backdrop_symbol_color)),
    backdropText: rgbIntToHex(safeColor(row.backdrop_text_color)),
    modelFileId: nullableString(row.model_file_id),
    modelThumbFileId: nullableString(row.model_thumb_file_id),
    modelMediaUrl: safeMediaUrl(row.model_media_url),
    modelPreviewUrl: safeMediaUrl(row.model_preview_url),
    imageUrl: resolveGiftImageUrl(row),
    symbolFileId: nullableString(row.symbol_file_id),
    symbolThumbFileId: nullableString(row.symbol_thumb_file_id),
    symbolMediaUrl: safeMediaUrl(row.symbol_media_url),
    symbolMediaKind: mediaKind(row.symbol_is_animated, row.symbol_is_video, "Gift symbol"),
    mediaKind: mediaKind(row.model_is_animated, row.model_is_video, "Gift model"),
    isPremium: Boolean(row.is_premium),
    isBurned: Boolean(row.is_burned),
    isFromBlockchain: Boolean(row.is_from_blockchain),
    lastSeenAt: safeIsoDate(row.last_seen_at) || safeIsoDate(row.updated_at) || new Date(0).toISOString(),
    catalogSource: row.catalog_source === "tonapi" ? "tonapi" : row.catalog_source === "bot_catalog" ? "bot_catalog" : "profile_sync",
    bestOffer: nullableNumber(row.best_offer, "gift best offer"),
    offerCount: requiredNumber(row.offer_count, "gift offer count"),
    ownerId: nullableString(row.owner_profile_id) || "",
    ownerName: nullableString(row.owner_name) || "Пользователь",
    acquiredPrice: nullableNumber(row.acquired_price, "gift acquisition price") ?? 0,
    listingPrice: nullableNumber(row.listing_price, "gift listing price"),
    lastSalePrice: nullableNumber(row.last_sale_price, "gift last sale price"),
    estimatedValue: nullableNumber(row.estimated_value, "gift estimated value"),
    externalListingPrice: nullableNumber(row.external_listing_price_ton, "external listing price"),
    externalPriceSource: nullableString(row.external_price_source),
    externalPriceSeenAt: safeIsoDate(row.external_price_seen_at),
    referencePrice: nullableNumber(row.reference_price_ton, "gift reference price"),
    priceBasis: row.price_basis === "mxm_listing" || row.price_basis === "tonapi_listing" || row.price_basis === "item_last_sale" || row.price_basis === "collection_last_sale" ? row.price_basis : null,
    collectionFloor: nullableNumber(row.collection_floor, "collection floor"),
    modelFloor: nullableNumber(row.model_floor, "model floor"),
    backdropFloor: nullableNumber(row.backdrop_floor, "backdrop floor"),
    symbolFloor: nullableNumber(row.symbol_floor, "symbol floor"),
    chainNftAddress: nullableString(row.chain_nft_address),
    chainCollectionAddress: nullableString(row.chain_collection_address),
    chainVerified: Boolean(row.chain_verified),
    listedAt: safeIsoDate(row.listed_at),
    listingUpdatedAt: safeIsoDate(row.listing_updated_at),
    listingExpiresAt: safeIsoDate(row.listing_expires_at),
    status: safeStatus,
    createdAt: safeIsoDate(row.created_at, new Date(0).toISOString()) || new Date(0).toISOString(),
  };
}


export function mapGiftCollection(row: Record<string, unknown>): GiftCollection {
  return {
    baseName: requiredString(row.base_name, "collection name", "Подарок"),
    itemCount: requiredNumber(row.item_count, "collection item count"),
    holderCount: requiredNumber(row.holder_count, "collection holder count"),
    listedCount: requiredNumber(row.listed_count, "collection listed count"),
    floorPrice: nullableNumber(row.floor_price, "collection floor"),
    lastSalePrice: nullableNumber(row.last_sale_price, "collection last sale"),
    volume24h: requiredNumber(row.volume_24h, "collection 24h volume"),
    change24h: requiredNumber(row.change_24h, "collection 24h change"),
    tradeCount24h: requiredNumber(row.trade_count_24h, "collection 24h trade count"),
    volume7d: requiredNumber(row.volume_7d, "collection 7d volume"),
    tradeCount7d: requiredNumber(row.trade_count_7d, "collection 7d trade count"),
    listedPct: requiredNumber(row.listed_pct, "collection listed percentage"),
    allTimeVolume: requiredNumber(row.all_time_volume, "collection all-time volume"),
    totalSales: requiredNumber(row.total_sales, "collection total sales"),
    highSale: nullableNumber(row.high_sale, "collection high sale"),
    externalFloor: nullableNumber(row.external_floor, "collection external floor"),
  };
}
