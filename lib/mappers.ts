import { rgbIntToHex } from "@/lib/format";
import type { Coin, GiftAsset, GiftMediaKind } from "@/lib/types";

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${name}`);
  return value;
}

function stringValue(value: unknown, name: string) {
  if (typeof value !== "string") throw new Error(`Invalid ${name}`);
  return value;
}

function requiredNumber(value: unknown, name: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${name}`);
  return number;
}

function nullableString(value: unknown) {
  return value == null ? null : String(value);
}

function nullableNumber(value: unknown, name: string) {
  if (value == null) return null;
  return requiredNumber(value, name);
}

function mediaKind(animated: unknown, video: unknown, label: string): GiftMediaKind {
  if (animated === true && video === true) throw new Error(`${label} cannot be animated and video at the same time`);
  if (video === true) return "video";
  if (animated === true) return "animated";
  if (video === false && animated === false) return "static";
  throw new Error(`Invalid ${label} media metadata`);
}

export function mapCoin(row: Record<string, any>): Coin {
  return {
    id: requiredString(row.id, "coin id"),
    creatorId: nullableString(row.creator_profile_id),
    name: requiredString(row.name, "coin name"),
    symbol: requiredString(row.symbol, "coin symbol"),
    imageUrl: nullableString(row.image_url),
    description: stringValue(row.description, "coin description"),
    currentPrice: requiredNumber(row.current_price, "coin current price"),
    marketCap: requiredNumber(row.market_cap, "coin market cap"),
    volume24h: requiredNumber(row.volume_24h, "coin 24h volume"),
    change24h: requiredNumber(row.change_24h, "coin 24h change"),
    holderCount: requiredNumber(row.holder_count, "coin holder count"),
    tradeCount24h: requiredNumber(row.trade_count_24h, "coin trade count"),
    createdAt: requiredString(row.created_at, "coin created_at"),
    creatorName: nullableString(row.creator_name),
    liquidity: requiredNumber(row.liquidity, "coin liquidity"),
    allTimeVolume: requiredNumber(row.all_time_volume, "coin all-time volume"),
    athPrice: requiredNumber(row.ath_price, "coin ATH"),
    buyVolume24h: requiredNumber(row.buy_volume_24h, "coin 24h buy volume"),
    sellVolume24h: requiredNumber(row.sell_volume_24h, "coin 24h sell volume"),
  };
}

export function mapGift(row: Record<string, any>): GiftAsset {
  const status = row.status;
  if (status !== "owned" && status !== "listed") throw new Error("Invalid Gift market status");

  return {
    id: requiredString(row.asset_id, "gift asset id"),
    virtualGiftId: requiredString(row.virtual_gift_id, "virtual gift id"),
    telegramName: requiredString(row.telegram_name, "Telegram gift name"),
    giftId: nullableString(row.gift_id),
    baseName: requiredString(row.base_name, "gift base name"),
    number: requiredNumber(row.gift_number, "gift number"),
    modelName: requiredString(row.model_name, "gift model name"),
    modelRarityPerMille: requiredNumber(row.model_rarity_per_mille, "model rarity"),
    modelRarity: nullableString(row.model_rarity),
    symbolName: requiredString(row.symbol_name, "gift symbol name"),
    symbolRarityPerMille: requiredNumber(row.symbol_rarity_per_mille, "symbol rarity"),
    backdropName: requiredString(row.backdrop_name, "gift backdrop name"),
    backdropRarityPerMille: requiredNumber(row.backdrop_rarity_per_mille, "backdrop rarity"),
    backdropCenter: rgbIntToHex(requiredNumber(row.backdrop_center_color, "backdrop center color")),
    backdropEdge: rgbIntToHex(requiredNumber(row.backdrop_edge_color, "backdrop edge color")),
    backdropSymbol: rgbIntToHex(requiredNumber(row.backdrop_symbol_color, "backdrop symbol color")),
    backdropText: rgbIntToHex(requiredNumber(row.backdrop_text_color, "backdrop text color")),
    modelFileId: requiredString(row.model_file_id, "gift model file id"),
    modelThumbFileId: nullableString(row.model_thumb_file_id),
    symbolFileId: requiredString(row.symbol_file_id, "gift symbol file id"),
    symbolThumbFileId: nullableString(row.symbol_thumb_file_id),
    symbolMediaKind: mediaKind(row.symbol_is_animated, row.symbol_is_video, "Gift symbol"),
    mediaKind: mediaKind(row.model_is_animated, row.model_is_video, "Gift model"),
    isPremium: Boolean(row.is_premium),
    isBurned: Boolean(row.is_burned),
    isFromBlockchain: Boolean(row.is_from_blockchain),
    lastSeenAt: requiredString(row.last_seen_at, "gift last_seen_at"),
    bestOffer: nullableNumber(row.best_offer, "gift best offer"),
    offerCount: requiredNumber(row.offer_count, "gift offer count"),
    ownerId: requiredString(row.owner_profile_id, "gift owner id"),
    ownerName: requiredString(row.owner_name, "gift owner name"),
    acquiredPrice: requiredNumber(row.acquired_price, "gift acquisition price"),
    listingPrice: nullableNumber(row.listing_price, "gift listing price"),
    lastSalePrice: nullableNumber(row.last_sale_price, "gift last sale price"),
    estimatedValue: nullableNumber(row.estimated_value, "gift estimated value"),
    status,
    createdAt: requiredString(row.created_at, "gift created_at"),
  };
}
