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
  observed_price_ton?: number;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rarityScore(candidate: Candidate) {
  const values = [candidate.model_rarity_per_mille, candidate.symbol_rarity_per_mille, candidate.backdrop_rarity_per_mille]
    .map((value) => clamp(Number(value), 0, 1000));
  const scores = values.map((value) => clamp(Math.log10(1001 / (value + 1)) / 3, 0, 1));
  return clamp(scores.reduce((sum, value) => sum + value, 0) / scores.length, 0, 1);
}

function observedPrice(candidate: Candidate) {
  const value = Number(candidate.observed_price_ton);
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) {
    throw new Error(`Gift ${candidate.asset_id} has no valid observed TON listing price`);
  }
  // Preserve real marketplace precision instead of manufacturing a rounded
  // pseudo-price. PostgreSQL stores up to 9 fractional TON digits here.
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
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

  // Reconcile old v0.13 synthetic NPC prices before publishing anything. This
  // RPC is provided by migration 015 and is intentionally tolerant on older
  // databases so deploys can still surface the migration hint instead of dying
  // before initialize_gift_genesis_pool() is called.
  const reconcile = await supabase.rpc("reconcile_npc_external_prices");
  if (reconcile.error && !/Could not find the function|schema cache|reconcile_npc_external_prices/i.test(String(reconcile.error.message || ""))) {
    throw reconcile.error;
  }

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
    if (candidates.length) {
      const priceResult = await supabase
        .from("gift_assets")
        .select("id,telegram_resale_price_ton")
        .in("id", candidates.map((candidate) => candidate.asset_id));
      if (priceResult.error) throw priceResult.error;
      const prices = new Map((priceResult.data || []).map((row) => [String(row.id), Number(row.telegram_resale_price_ton)]));
      for (const candidate of candidates) candidate.observed_price_ton = prices.get(candidate.asset_id);
    }
    if (!candidates.length) {
      const refreshed = await supabase.rpc("initialize_gift_genesis_pool");
      if (refreshed.error) throw refreshed.error;
      state = parseGenesisState(refreshed.data);
      await supabase.rpc("release_npc_market_lock", { p_success: true, p_error: null });
      return { skipped: false, currentListings, created: 0, rareDeals: 0, ...state };
    }

    let created = 0;
    for (let start = 0; start < candidates.length; start += 12) {
      const chunk = candidates.slice(start, start + 12);
      const results = await Promise.all(chunk.map(async (candidate) => {
        const price = observedPrice(candidate);
        const seeded = await supabase.rpc("npc_seed_virtual_gift", {
          p_asset_id: candidate.asset_id,
          // The DB function also re-reads the observed asset price and ignores
          // synthetic client/server guesses. Passing it here keeps compatibility
          // with the existing RPC signature.
          p_price: price,
          p_fair_price: price,
          p_rarity_score: rarityScore(candidate),
          p_pricing_mode: "normal",
          p_desk: Math.abs(Number(candidate.gift_number) || 0) % 3,
        });
        if (seeded.error) {
          if (/already|unique|duplicate/i.test(String(seeded.error.message || ""))) return false;
          throw seeded.error;
        }
        return true;
      }));
      created += results.filter(Boolean).length;
    }

    const refreshed = await supabase.rpc("initialize_gift_genesis_pool");
    if (refreshed.error) throw refreshed.error;
    state = parseGenesisState(refreshed.data);
    await supabase.rpc("release_npc_market_lock", { p_success: true, p_error: null });
    return { skipped: false, currentListings: currentListings + created, created, rareDeals: 0, ...state };
  } catch (error) {
    await supabase.rpc("release_npc_market_lock", { p_success: false, p_error: error instanceof Error ? error.message : "Genesis market failure" });
    throw error;
  }
}

// Compatibility for existing control actions. The market never invents a TON
// price: system listings are created only when TonAPI exposes a live native-TON
// sale price for that exact NFT.
export async function ensureNpcMarketLiquidity(options: { targetListings?: number; force?: boolean } = {}) {
  return ensureGenesisGiftMarket({ batchSize: options.targetListings ?? 24, force: options.force });
}
