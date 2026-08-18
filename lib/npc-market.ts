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
};

export type NpcLiquidityResult = {
  skipped: boolean;
  currentListings: number;
  created: number;
  rareDeals: number;
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
  // rarity_per_mille is a frequency: lower values are rarer. A log scale keeps
  // common traits from being treated as almost as rare as 1–10‰ traits.
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

function priceCandidate(candidate: Candidate, collectionAnchor: number | null, cycle: number) {
  const score = rarityScore(candidate);
  const intrinsic = 2.2 + 42 * Math.pow(score, 1.72) + numberPremium(Number(candidate.gift_number));
  const fair = collectionAnchor && collectionAnchor > 0
    ? intrinsic * 0.42 + collectionAnchor * 0.58
    : intrinsic;
  const seed = `${candidate.asset_id}:${cycle}:${new Date().toISOString().slice(0, 10)}`;
  const mood = 0.9 + unit(seed, 1) * 0.22;
  const dealRoll = unit(seed, 2);
  const discountRoll = unit(seed, 3);

  let mode: "normal" | "discount" | "rare_deal" = "normal";
  let multiplier = mood;

  // A small, auditable market mechanic: genuinely rare catalogue assets can
  // occasionally be mispriced by an NPC. This changes only the virtual MXM
  // listing price; Telegram metadata itself is never invented or modified.
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

export async function ensureNpcMarketLiquidity(options: { targetListings?: number; force?: boolean } = {}): Promise<NpcLiquidityResult> {
  const supabase = getSupabaseAdmin();
  const target = clamp(Math.floor(options.targetListings ?? 18), 6, 60);
  const cooldown = options.force ? 5 : 20;
  const lock = await supabase.rpc("acquire_npc_market_lock", { p_cooldown_seconds: cooldown, p_lock_seconds: 8 });
  if (lock.error) throw lock.error;
  if (lock.data !== true) {
    const count = await supabase.rpc("npc_market_listing_count");
    if (count.error) throw count.error;
    return { skipped: true, currentListings: Number(count.data || 0), created: 0, rareDeals: 0 };
  }

  try {
    const countResult = await supabase.rpc("npc_market_listing_count");
    if (countResult.error) throw countResult.error;
    const currentListings = Number(countResult.data || 0);
    if (currentListings >= target) {
      await supabase.rpc("release_npc_market_lock", { p_success: true, p_error: null });
      return { skipped: false, currentListings, created: 0, rareDeals: 0 };
    }

    const need = target - currentListings;
    const candidateResult = await supabase.rpc("npc_market_candidates", { p_limit: Math.min(need * 8, 160) });
    if (candidateResult.error) throw candidateResult.error;
    const candidates = (candidateResult.data || []) as Candidate[];
    if (!candidates.length) {
      await supabase.rpc("release_npc_market_lock", { p_success: true, p_error: null });
      return { skipped: false, currentListings, created: 0, rareDeals: 0 };
    }

    const baseNames = [...new Set(candidates.map((candidate) => String(candidate.base_name)))];
    const collections = await supabase
      .from("gift_collection_overview")
      .select("base_name,floor_price,last_sale_price")
      .in("base_name", baseNames);
    if (collections.error) throw collections.error;
    const anchors = new Map<string, number>();
    for (const row of collections.data || []) {
      const floor = row.floor_price == null ? null : Number(row.floor_price);
      const last = row.last_sale_price == null ? null : Number(row.last_sale_price);
      const values = [floor, last].filter((value): value is number => Number.isFinite(value) && value! > 0);
      if (values.length) anchors.set(String(row.base_name), values.reduce((sum, value) => sum + value, 0) / values.length);
    }

    const stateResult = await supabase.from("npc_market_state").select("cycle").eq("key", "gift-liquidity").single();
    if (stateResult.error) throw stateResult.error;
    const cycle = Number(stateResult.data?.cycle || 0);

    let created = 0;
    let rareDeals = 0;
    for (const candidate of candidates) {
      if (created >= need) break;
      const pricing = priceCandidate(candidate, anchors.get(candidate.base_name) ?? null, cycle);
      const seeded = await supabase.rpc("npc_seed_virtual_gift", {
        p_asset_id: candidate.asset_id,
        p_price: pricing.listingPrice,
        p_fair_price: pricing.fairPrice,
        p_rarity_score: pricing.rarityScore,
        p_pricing_mode: pricing.mode,
        p_desk: pricing.desk,
      });
      if (seeded.error) {
        // A concurrent request may have consumed the candidate. Skip only that
        // asset; all other failures are still visible in server logs.
        if (/already|unique|duplicate/i.test(String(seeded.error.message || ""))) continue;
        throw seeded.error;
      }
      created += 1;
      if (pricing.mode === "rare_deal") rareDeals += 1;
    }

    await supabase.rpc("release_npc_market_lock", { p_success: true, p_error: null });
    return { skipped: false, currentListings: currentListings + created, created, rareDeals };
  } catch (error) {
    await supabase.rpc("release_npc_market_lock", {
      p_success: false,
      p_error: error instanceof Error ? error.message : "NPC market failure",
    });
    throw error;
  }
}
