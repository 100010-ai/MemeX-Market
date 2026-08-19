import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Candidate = {
  asset_id: string;
  base_name: string;
  gift_number: number;
  model_rarity_per_mille: number;
  symbol_rarity_per_mille: number;
  backdrop_rarity_per_mille: number;
  last_seen_at: string;
  rarity_tier?: string;
  release_key?: string;
};

type GenesisState = {
  total: number;
  released: number;
  remaining: number;
  completed: boolean;
  seed: string;
};

export type NpcLiquidityResult = {
  skipped: boolean;
  currentListings: number;
  created: number;
  rareDeals: number;
  total: number;
  released: number;
  remaining: number;
  completed: boolean;
};

function unit(seed: string, lane = 0) {
  const digest = crypto.createHash("sha256").update(`${seed}:${lane}`).digest();
  return digest.readUInt32BE((lane % 7) * 4) / 0xffffffff;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rarityScore(candidate: Candidate) {
  const values = [candidate.model_rarity_per_mille, candidate.symbol_rarity_per_mille, candidate.backdrop_rarity_per_mille]
    .map((value) => clamp(Number(value), 0, 1000));
  const scores = values.map((value) => clamp(Math.log10(1001 / (value + 1)) / 3, 0, 1));
  return clamp(scores.reduce((sum, value) => sum + value, 0) / scores.length, 0, 1);
}

function numberPremium(number: number) {
  if (number <= 10) return 12;
  if (number <= 100) return 6;
  if (number <= 1000) return 2.5;
  const text = String(number);
  if (/^(\d)\1+$/.test(text)) return 4;
  if (text === text.split("").reverse().join("")) return 2;
  if (number % 1000 === 0) return 1.5;
  return 0;
}

function priceCandidate(candidate: Candidate, collectionAnchor: number | null, genesisSeed: string) {
  const score = rarityScore(candidate);
  const intrinsic = 2.2 + 42 * Math.pow(score, 1.72) + numberPremium(Number(candidate.gift_number));
  const fair = collectionAnchor && collectionAnchor > 0 ? intrinsic * 0.42 + collectionAnchor * 0.58 : intrinsic;
  const seed = `${genesisSeed}:${candidate.asset_id}`;
  const mood = 0.9 + unit(seed, 1) * 0.22;
  const dealRoll = unit(seed, 2);
  const discountRoll = unit(seed, 3);

  let mode: "normal" | "discount" | "rare_deal" = "normal";
  let multiplier = mood;
  if (score >= 0.5 && dealRoll < 0.035) {
    mode = "rare_deal";
    multiplier = 0.42 + unit(seed, 4) * 0.28;
  } else if (discountRoll < 0.18) {
    mode = "discount";
    multiplier = 0.78 + unit(seed, 5) * 0.14;
  }

  const fairPrice = clamp(fair, 0.5, 140);
  const listingPrice = clamp(fairPrice * multiplier, 0.35, 95);
  return {
    rarityScore: score,
    fairPrice: Math.round(fairPrice * 100) / 100,
    listingPrice: Math.round(listingPrice * 100) / 100,
    mode,
    desk: Math.floor(unit(seed, 6) * 3) % 3,
  };
}

function parseGenesisState(value: unknown): GenesisState {
  const row = (value || {}) as Record<string, unknown>;
  return {
    total: Number(row.total || 0),
    released: Number(row.released || 0),
    remaining: Number(row.remaining || 0),
    completed: Boolean(row.completed),
    seed: String(row.seed || "mxm-genesis"),
  };
}

export async function ensureGenesisGiftMarket(options: { batchSize?: number; force?: boolean } = {}): Promise<NpcLiquidityResult> {
  const supabase = getSupabaseAdmin();
  const initialized = await supabase.rpc("initialize_gift_genesis_pool");
  if (initialized.error) throw initialized.error;
  let state = parseGenesisState(initialized.data);

  const countResult = await supabase.rpc("npc_market_listing_count");
  if (countResult.error) throw countResult.error;
  const currentListings = Number(countResult.data || 0);
  if (state.completed || state.remaining <= 0 || state.total <= 0) {
    return { skipped: true, currentListings, created: 0, rareDeals: 0, ...state };
  }

  const batchSize = clamp(Math.floor(options.batchSize ?? 24), 1, 1000);
  const lock = await supabase.rpc("acquire_npc_market_lock", {
    p_cooldown_seconds: options.force ? 5 : 10,
    p_lock_seconds: 12,
  });
  if (lock.error) throw lock.error;
  if (lock.data !== true) return { skipped: true, currentListings, created: 0, rareDeals: 0, ...state };

  try {
    const candidateResult = await supabase.rpc("genesis_market_candidates", { p_limit: batchSize });
    if (candidateResult.error) throw candidateResult.error;
    const candidates = (candidateResult.data || []) as Candidate[];
    if (!candidates.length) {
      const refreshed = await supabase.rpc("initialize_gift_genesis_pool");
      if (refreshed.error) throw refreshed.error;
      state = parseGenesisState(refreshed.data);
      await supabase.rpc("release_npc_market_lock", { p_success: true, p_error: null });
      return { skipped: false, currentListings, created: 0, rareDeals: 0, ...state };
    }

    const baseNames = [...new Set(candidates.map((candidate) => String(candidate.base_name)))];
    const collections = await supabase.from("gift_collection_overview").select("base_name,floor_price,last_sale_price").in("base_name", baseNames);
    if (collections.error) throw collections.error;
    const anchors = new Map<string, number>();
    for (const row of collections.data || []) {
      const values = [row.floor_price, row.last_sale_price].map(Number).filter((value) => Number.isFinite(value) && value > 0);
      if (values.length) anchors.set(String(row.base_name), values.reduce((sum, value) => sum + value, 0) / values.length);
    }

    let created = 0;
    let rareDeals = 0;
    for (let start = 0; start < candidates.length; start += 12) {
      const chunk = candidates.slice(start, start + 12);
      const results = await Promise.all(chunk.map(async (candidate) => {
        const pricing = priceCandidate(candidate, anchors.get(candidate.base_name) ?? null, state.seed);
        const seeded = await supabase.rpc("npc_seed_virtual_gift", {
          p_asset_id: candidate.asset_id,
          p_price: pricing.listingPrice,
          p_fair_price: pricing.fairPrice,
          p_rarity_score: pricing.rarityScore,
          p_pricing_mode: pricing.mode,
          p_desk: pricing.desk,
        });
        if (seeded.error) {
          if (/already|unique|duplicate/i.test(String(seeded.error.message || ""))) return null;
          throw seeded.error;
        }
        return pricing.mode;
      }));
      for (const mode of results) {
        if (!mode) continue;
        created += 1;
        if (mode === "rare_deal") rareDeals += 1;
      }
    }

    const refreshed = await supabase.rpc("initialize_gift_genesis_pool");
    if (refreshed.error) throw refreshed.error;
    state = parseGenesisState(refreshed.data);
    await supabase.rpc("release_npc_market_lock", { p_success: true, p_error: null });
    return { skipped: false, currentListings: currentListings + created, created, rareDeals, ...state };
  } catch (error) {
    await supabase.rpc("release_npc_market_lock", { p_success: false, p_error: error instanceof Error ? error.message : "Genesis market failure" });
    throw error;
  }
}

// Compatibility for existing control actions. v0.11 no longer maintains a
// target number of NPC listings: it releases a finite Genesis batch only once.
export async function ensureNpcMarketLiquidity(options: { targetListings?: number; force?: boolean } = {}) {
  return ensureGenesisGiftMarket({ batchSize: options.targetListings ?? 24, force: options.force });
}
