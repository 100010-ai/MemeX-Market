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

export type GiftMarketLiquidityState = {
  mode: "npc_bootstrap" | "player_only";
  playerOnly: boolean;
  playerOwned: number;
  playerListed: number;
  activeSellers: number;
  npcListed: number;
  playerOwnedThreshold: number;
  playerListedThreshold: number;
  activeSellersThreshold: number;
  ready: boolean;
  transitionedAt: string | null;
  npcRemoved?: number;
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

function parseLiquidityState(value: unknown): GiftMarketLiquidityState {
  const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    mode: row.mode === "player_only" ? "player_only" : "npc_bootstrap",
    playerOnly: row.playerOnly === true || row.mode === "player_only",
    playerOwned: Math.max(0, Number(row.playerOwned) || 0),
    playerListed: Math.max(0, Number(row.playerListed) || 0),
    activeSellers: Math.max(0, Number(row.activeSellers) || 0),
    npcListed: Math.max(0, Number(row.npcListed) || 0),
    playerOwnedThreshold: Math.max(1, Number(row.playerOwnedThreshold) || 500),
    playerListedThreshold: Math.max(1, Number(row.playerListedThreshold) || 120),
    activeSellersThreshold: Math.max(1, Number(row.activeSellersThreshold) || 20),
    ready: row.ready === true,
    transitionedAt: typeof row.transitionedAt === "string" && row.transitionedAt ? row.transitionedAt : null,
    npcRemoved: Math.max(0, Number(row.npcRemoved) || 0),
  };
}

export async function getGiftMarketLiquidityState(): Promise<GiftMarketLiquidityState> {
  const result = await getSupabaseAdmin().rpc("gift_market_liquidity_state");
  if (result.error) throw result.error;
  return parseLiquidityState(result.data);
}

export async function evaluatePlayerMarketHandoff(force = false): Promise<GiftMarketLiquidityState> {
  const result = await getSupabaseAdmin().rpc("maybe_handoff_gift_market_to_players", { p_force: force });
  if (result.error) throw result.error;
  return parseLiquidityState(result.data);
}

export async function configureGiftMarketLiquidityPolicy(input: { playerOwnedThreshold: number; playerListedThreshold: number; activeSellersThreshold: number }): Promise<GiftMarketLiquidityState> {
  const result = await getSupabaseAdmin().rpc("configure_gift_market_liquidity_policy", {
    p_player_owned_threshold: Math.max(1, Math.trunc(input.playerOwnedThreshold)),
    p_player_listed_threshold: Math.max(1, Math.trunc(input.playerListedThreshold)),
    p_active_sellers_threshold: Math.max(1, Math.trunc(input.activeSellersThreshold)),
  });
  if (result.error) throw result.error;
  return parseLiquidityState(result.data);
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

function observedPrice(candidate: Candidate) {
  const value = Number(candidate.observed_price_ton);
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return null;
  // Preserve real marketplace precision instead of manufacturing a rounded
  // pseudo-price. PostgreSQL stores up to 9 fractional TON digits here.
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function isPlayerOnlyListingError(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message || "") : String(error || "");
  return /NPC liquidity is permanently disabled|player-only Gift market/i.test(message);
}

function parseGenesisState(value: unknown): GenesisState {
  const row = (value || {}) as Record<string, unknown>;
  return {
    total: Math.max(0, Number(row.total) || 0),
    released: Math.max(0, Number(row.released) || 0),
    remaining: Math.max(0, Number(row.remaining) || 0),
    completed: Boolean(row.completed),
    seed: String(row.seed || "mxm-genesis"),
  };
}

export async function ensureGenesisGiftMarket(options: { batchSize?: number; force?: boolean } = {}): Promise<NpcLiquidityResult> {
  const supabase = getSupabaseAdmin();

  // NPC inventory is bootstrap liquidity only. The handoff is irreversible: once
  // player ownership + listings + seller breadth reach policy thresholds, no
  // future bootstrap/admin call is allowed to repopulate system listings.
  const liquidity = await evaluatePlayerMarketHandoff(false);
  if (liquidity.playerOnly) {
    return {
      skipped: true,
      currentListings: 0,
      created: 0,
      rareDeals: 0,
      total: 0,
      released: 0,
      remaining: 0,
      completed: true,
    };
  }

  // Reads that do not mutate the Genesis catalogue happen before the lock. If a
  // different worker already owns the maintenance lease, this path stays cheap.
  const [stateResult, countResult] = await Promise.all([
    supabase.rpc("gift_genesis_counter_state_v0655"),
    supabase.rpc("npc_market_listing_count"),
  ]);
  if (stateResult.error) throw stateResult.error;
  if (countResult.error) throw countResult.error;
  let state = parseGenesisState(stateResult.data);
  const currentListings = Math.max(0, Number(countResult.data) || 0);
  if (state.completed && state.total > 0) {
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
    // These mutations can touch thousands of catalogue rows. They run only for
    // the worker that acquired the lease, never concurrently in every request.
    const reconcile = await supabase.rpc("reconcile_npc_external_prices");
    if (reconcile.error) throw reconcile.error;

    const initialized = await supabase.rpc("initialize_gift_genesis_pool");
    if (initialized.error) throw initialized.error;
    state = parseGenesisState(initialized.data);
    if (state.completed || state.remaining <= 0 || state.total <= 0) {
      const release = await supabase.rpc("release_npc_market_lock", { p_success: true, p_error: null });
      if (release.error) throw release.error;
      return { skipped: true, currentListings, created: 0, rareDeals: 0, ...state };
    }

    const candidateResult = await supabase.rpc("genesis_market_candidates", { p_limit: batchSize });
    if (candidateResult.error) throw candidateResult.error;
    const candidates = (candidateResult.data || []) as Candidate[];
    if (candidates.length) {
      const priceResult = await supabase
        .from("gift_assets")
        .select("id,telegram_resale_price_ton")
        .in("id", candidates.map((candidate) => candidate.asset_id));
      if (priceResult.error) throw priceResult.error;
      const prices = new Map<string, number>(((priceResult.data || []) as Array<{ id: unknown; telegram_resale_price_ton: unknown }>).map((row) => [String(row.id), Number(row.telegram_resale_price_ton)] as [string, number]));
      for (const candidate of candidates) candidate.observed_price_ton = prices.get(candidate.asset_id);
    }

    if (!candidates.length) {
      const refreshed = await supabase.rpc("gift_genesis_counter_state_v0655");
      if (refreshed.error) throw refreshed.error;
      state = parseGenesisState(refreshed.data);
      const release = await supabase.rpc("release_npc_market_lock", { p_success: true, p_error: null });
      if (release.error) throw release.error;
      return { skipped: false, currentListings, created: 0, rareDeals: 0, ...state };
    }

    let created = 0;
    for (let start = 0; start < candidates.length; start += 12) {
      const chunk = candidates.slice(start, start + 12);
      const results = await Promise.all(chunk.map(async (candidate) => {
        const price = observedPrice(candidate);
        if (price == null) return "skipped" as const;
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
          if (isPlayerOnlyListingError(seeded.error)) return "handoff" as const;
          if (/already|unique|duplicate|fresh observed native TON listing price|observed native TON listing price is required/i.test(String(seeded.error.message || ""))) return "skipped" as const;
          throw seeded.error;
        }
        return "created" as const;
      }));
      created += results.filter((result) => result === "created").length;
      if (results.includes("handoff")) {
        const release = await supabase.rpc("release_npc_market_lock", { p_success: true, p_error: null });
        if (release.error) throw release.error;
        return { skipped: true, currentListings: 0, created, rareDeals: 0, ...state, completed: true };
      }
    }

    // npc_seed_virtual_gift increments Genesis state exactly once per newly
    // released asset, so the final status is a single-row read rather than a
    // second full catalogue/pool reconciliation.
    const refreshed = await supabase.rpc("gift_genesis_counter_state_v0655");
    if (refreshed.error) throw refreshed.error;
    state = parseGenesisState(refreshed.data);
    const release = await supabase.rpc("release_npc_market_lock", { p_success: true, p_error: null });
    if (release.error) throw release.error;
    return { skipped: false, currentListings: currentListings + created, created, rareDeals: 0, ...state };
  } catch (error) {
    const release = await supabase.rpc("release_npc_market_lock", { p_success: false, p_error: error instanceof Error ? error.message : "Genesis market failure" });
    if (release.error) console.error("npc market lock release", release.error);
    throw error;
  }
}

// Compatibility for existing control actions. The market never invents a TON
// price: system listings are created only when TonAPI exposes a live native-TON
// sale price for that exact NFT.
export async function ensureNpcMarketLiquidity(options: { targetListings?: number; force?: boolean } = {}) {
  return ensureGenesisGiftMarket({ batchSize: options.targetListings ?? 24, force: options.force });
}
