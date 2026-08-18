import { rgbIntToHex } from "@/lib/format";
import type { Coin, GiftAsset, GiftMediaKind } from "@/lib/types";

export function mapCoin(row: Record<string, any>): Coin {
  return {
    id: String(row.id),
    name: String(row.name),
    symbol: String(row.symbol),
    description: String(row.description ?? ""),
    currentPrice: Number(row.current_price ?? 0),
    marketCap: Number(row.market_cap ?? 0),
    volume24h: Number(row.volume_24h ?? 0),
    change24h: Number(row.change_24h ?? 0),
    holderCount: Number(row.holder_count ?? 0),
    createdAt: String(row.created_at),
    creatorName: row.creator_name ? String(row.creator_name) : null,
  };
}

export function mapGift(row: Record<string, any>): GiftAsset {
  let mediaKind: GiftMediaKind = "static";
  if (row.source === "demo") mediaKind = "demo";
  else if (row.model_is_video) mediaKind = "video";
  else if (row.model_is_animated) mediaKind = "animated";

  return {
    id: String(row.asset_id),
    virtualGiftId: String(row.virtual_gift_id),
    source: row.source === "demo" ? "demo" : "telegram",
    telegramName: row.telegram_name ? String(row.telegram_name) : null,
    giftId: row.gift_id ? String(row.gift_id) : null,
    baseName: String(row.base_name),
    number: Number(row.gift_number),
    modelName: String(row.model_name),
    modelRarityPerMille: Number(row.model_rarity_per_mille ?? 0),
    modelRarity: row.model_rarity ? String(row.model_rarity) : null,
    symbolName: String(row.symbol_name),
    symbolRarityPerMille: Number(row.symbol_rarity_per_mille ?? 0),
    backdropName: String(row.backdrop_name),
    backdropRarityPerMille: Number(row.backdrop_rarity_per_mille ?? 0),
    backdropCenter: rgbIntToHex(Number(row.backdrop_center_color)),
    backdropEdge: rgbIntToHex(Number(row.backdrop_edge_color)),
    backdropSymbol: rgbIntToHex(Number(row.backdrop_symbol_color)),
    backdropText: rgbIntToHex(Number(row.backdrop_text_color), "#ffffff"),
    modelFileId: row.model_file_id ? String(row.model_file_id) : null,
    modelThumbFileId: row.model_thumb_file_id ? String(row.model_thumb_file_id) : null,
    symbolFileId: row.symbol_file_id ? String(row.symbol_file_id) : null,
    symbolThumbFileId: row.symbol_thumb_file_id ? String(row.symbol_thumb_file_id) : null,
    mediaKind,
    demoEmoji: row.demo_emoji ? String(row.demo_emoji) : null,
    isPremium: Boolean(row.is_premium),
    isFromBlockchain: Boolean(row.is_from_blockchain),
    referencePrice: Number(row.reference_price ?? 0),
    ownerId: row.owner_profile_id ? String(row.owner_profile_id) : null,
    ownerName: row.owner_name ? String(row.owner_name) : null,
    listingPrice: row.listing_price === null || row.listing_price === undefined ? null : Number(row.listing_price),
    lastSalePrice: row.last_sale_price === null || row.last_sale_price === undefined ? null : Number(row.last_sale_price),
    status: row.status === "listed" ? "listed" : "owned",
    createdAt: String(row.created_at),
  };
}
