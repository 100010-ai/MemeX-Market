import type { GiftAsset, GiftCollection } from "@/lib/types";

export type MXMScoreComponentKey = "rarity" | "liquidity" | "demand" | "momentum" | "scarcity";
export type MXMScore = {
  score: number;
  label: "Exceptional" | "Strong" | "Active" | "Balanced" | "Speculative";
  confidence: number;
  components: Record<MXMScoreComponentKey, number>;
};

type ItemStats = { tradeCount: number; volume: number; highSale: number | null; lowSale: number | null };

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function logProgress(value: number, target: number) {
  return clamp(100 * Math.log1p(Math.max(0, value)) / Math.log1p(Math.max(1, target)));
}

function rarityScore(gift: GiftAsset) {
  const frequencies = [gift.modelRarityPerMille, gift.backdropRarityPerMille, gift.symbolRarityPerMille]
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => clamp(value / 1000, 0.001, 1));
  if (!frequencies.length) return 50;
  const geometricMean = Math.pow(frequencies.reduce((product, value) => product * value, 1), 1 / frequencies.length);
  return clamp((1 - geometricMean) * 100);
}

export function calculateMXMScore({
  gift,
  collection,
  itemStats,
  offerCount = gift.offerCount || 0,
}: {
  gift: GiftAsset;
  collection: GiftCollection;
  itemStats: ItemStats;
  offerCount?: number;
}): MXMScore {
  const rarity = rarityScore(gift);
  const tradeVelocity = logProgress(collection.tradeCount7d, 35);
  const volumeVelocity = logProgress(collection.volume7d, Math.max(25, (collection.floorPrice || 1) * 60));
  const itemHistory = logProgress(itemStats.tradeCount, 8);
  const listingDepth = collection.itemCount > 0 ? clamp((collection.listedCount / collection.itemCount) * 250) : 0;
  const liquidity = clamp(tradeVelocity * 0.38 + volumeVelocity * 0.32 + itemHistory * 0.12 + listingDepth * 0.18);

  const offers = logProgress(offerCount, 8);
  const dayTrades = logProgress(collection.tradeCount24h, 10);
  const dayVolume = logProgress(collection.volume24h, Math.max(10, (collection.floorPrice || 1) * 18));
  const demand = clamp(dayTrades * 0.38 + dayVolume * 0.42 + offers * 0.20);

  // A flat market starts neutral. Positive moves increase the score, while a
  // sharp one-day dump lowers it without pretending this is a price forecast.
  const momentum = clamp(50 + collection.change24h * 1.5);

  const listedPct = collection.itemCount > 0 ? (collection.listedCount / collection.itemCount) * 100 : collection.listedPct;
  const holderBreadth = collection.itemCount > 0 ? clamp((collection.holderCount / collection.itemCount) * 100) : 0;
  const scarcity = clamp((100 - clamp(listedPct * 2.2)) * 0.52 + rarity * 0.34 + holderBreadth * 0.14);

  const score = clamp(
    rarity * 0.30
    + liquidity * 0.22
    + demand * 0.18
    + momentum * 0.15
    + scarcity * 0.15,
  );
  const confidenceSignals = [
    collection.itemCount > 0,
    collection.floorPrice != null && collection.floorPrice > 0,
    collection.tradeCount7d > 0,
    collection.volume7d > 0,
    itemStats.tradeCount > 0,
    gift.referencePrice != null && gift.referencePrice > 0,
  ].filter(Boolean).length;
  const confidence = Math.round(clamp(35 + confidenceSignals * 10 + Math.min(5, collection.tradeCount7d) * 1));
  const rounded = Math.round(score);
  const label: MXMScore["label"] = rounded >= 90 ? "Exceptional" : rounded >= 78 ? "Strong" : rounded >= 65 ? "Active" : rounded >= 50 ? "Balanced" : "Speculative";

  return {
    score: rounded,
    label,
    confidence,
    components: {
      rarity: Math.round(rarity),
      liquidity: Math.round(liquidity),
      demand: Math.round(demand),
      momentum: Math.round(momentum),
      scarcity: Math.round(scarcity),
    },
  };
}
