export type ProfileFrameDefinition = {
  key: string;
  title: string;
  cssClass: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  shortLabel: string;
  source?: "store" | "case" | "season" | "league" | "progression";
  exclusive?: boolean;
};

const FRAME_DEFINITIONS: ProfileFrameDefinition[] = [
  { key: "carbon_frame", title: "Carbon Black", cssClass: "mxm-profile-frame-carbon", rarity: "common", shortLabel: "Carbon", source: "store" },
  { key: "chrome_frame", title: "Liquid Chrome", cssClass: "mxm-profile-frame-chrome", rarity: "rare", shortLabel: "Chrome", source: "store" },
  { key: "frost_frame", title: "Arctic Frost", cssClass: "mxm-profile-frame-frost", rarity: "rare", shortLabel: "Frost", source: "store" },
  { key: "sunset_frame", title: "Solar Sunset", cssClass: "mxm-profile-frame-sunset", rarity: "epic", shortLabel: "Sunset", source: "store" },
  { key: "aurora_frame", title: "Aurora Glass", cssClass: "mxm-profile-frame-aurora", rarity: "epic", shortLabel: "Aurora", source: "store" },
  { key: "royal_frame", title: "Royal Gold", cssClass: "mxm-profile-frame-royal", rarity: "legendary", shortLabel: "Royal", source: "store" },
  { key: "void_frame", title: "Deep Space", cssClass: "mxm-profile-frame-void", rarity: "legendary", shortLabel: "Void", source: "store" },
  { key: "founder_frame", title: "Founder Edition", cssClass: "mxm-profile-frame-founder", rarity: "legendary", shortLabel: "Founder", source: "case", exclusive: true },
  // Backward-compatible visual for accounts that already bought the original frame.
  { key: "neon_frame", title: "Spectrum Legacy", cssClass: "mxm-profile-frame-spectrum", rarity: "epic", shortLabel: "Spectrum", source: "store" },

  // Progression / season frames.
  { key: "season_rift_frame", title: "Season Rift", cssClass: "mxm-profile-frame-rift", rarity: "epic", shortLabel: "Rift", source: "season", exclusive: true },
  { key: "season_master_frame", title: "Season Master", cssClass: "mxm-profile-frame-master", rarity: "legendary", shortLabel: "Master", source: "season", exclusive: true },
  { key: "account_vanguard_frame", title: "Vanguard 100", cssClass: "mxm-profile-frame-vanguard", rarity: "legendary", shortLabel: "Vanguard", source: "progression", exclusive: true },
  { key: "season_prestige_frame", title: "Prestige Orbit", cssClass: "mxm-profile-frame-prestige", rarity: "legendary", shortLabel: "Prestige", source: "season", exclusive: true },

  // Battle Pass frames that previously fell back to the generic frame visual.
  { key: "arctic_relay_frame", title: "Arctic Relay", cssClass: "mxm-profile-frame-arctic-relay", rarity: "epic", shortLabel: "Relay", source: "season", exclusive: true },
  { key: "circuit_elite_frame", title: "Circuit Elite", cssClass: "mxm-profile-frame-circuit-elite", rarity: "epic", shortLabel: "Circuit", source: "season", exclusive: true },
  { key: "ember_sentinel_frame", title: "Ember Sentinel", cssClass: "mxm-profile-frame-ember-sentinel", rarity: "legendary", shortLabel: "Ember", source: "season", exclusive: true },
  { key: "glacier_crown_frame", title: "Glacier Crown", cssClass: "mxm-profile-frame-glacier-crown", rarity: "legendary", shortLabel: "Glacier", source: "season", exclusive: true },
  { key: "iron_regent_frame", title: "Iron Regent", cssClass: "mxm-profile-frame-iron-regent", rarity: "legendary", shortLabel: "Regent", source: "season", exclusive: true },
  { key: "midnight_laurels_frame", title: "Midnight Laurels", cssClass: "mxm-profile-frame-midnight-laurels", rarity: "legendary", shortLabel: "Laurels", source: "season", exclusive: true },
  { key: "obsidian_signal_frame", title: "Obsidian Signal", cssClass: "mxm-profile-frame-obsidian-signal", rarity: "epic", shortLabel: "Signal", source: "season", exclusive: true },
  { key: "quantum_frost_frame", title: "Quantum Frost", cssClass: "mxm-profile-frame-quantum-frost", rarity: "legendary", shortLabel: "Quantum", source: "season", exclusive: true },
  { key: "vault_sovereign_frame", title: "Vault Sovereign", cssClass: "mxm-profile-frame-vault-sovereign", rarity: "legendary", shortLabel: "Sovereign", source: "season", exclusive: true },

  // MemeX League frames.
  { key: "league_challenger_frame", title: "League Challenger", cssClass: "mxm-profile-frame-league-challenger", rarity: "epic", shortLabel: "Challenger", source: "league", exclusive: true },
  { key: "league_apex_frame", title: "League Apex", cssClass: "mxm-profile-frame-league-apex", rarity: "legendary", shortLabel: "Apex", source: "league", exclusive: true },
  { key: "league_founder_frame", title: "League Founder", cssClass: "mxm-profile-frame-league-founder", rarity: "legendary", shortLabel: "L-Founder", source: "league", exclusive: true },

  // Content expansion v2.2. These use restrained material effects rather than neon.
  { key: "titanium_edge_frame", title: "Titanium Edge", cssClass: "mxm-profile-frame-titanium-edge", rarity: "rare", shortLabel: "Titanium", source: "store" },
  { key: "graphite_crown_frame", title: "Graphite Crown", cssClass: "mxm-profile-frame-graphite-crown", rarity: "epic", shortLabel: "Graphite", source: "store" },
  { key: "blue_hour_frame", title: "Blue Hour", cssClass: "mxm-profile-frame-blue-hour", rarity: "epic", shortLabel: "Blue Hour", source: "store" },
  { key: "black_ice_frame", title: "Black Ice", cssClass: "mxm-profile-frame-black-ice", rarity: "epic", shortLabel: "Black Ice", source: "case", exclusive: true },
  { key: "crimson_regent_frame", title: "Crimson Regent", cssClass: "mxm-profile-frame-crimson-regent", rarity: "epic", shortLabel: "Crimson", source: "case", exclusive: true },
  { key: "silver_archive_frame", title: "Silver Archive", cssClass: "mxm-profile-frame-silver-archive", rarity: "epic", shortLabel: "Archive", source: "store" },
  { key: "market_maker_frame", title: "Market Maker", cssClass: "mxm-profile-frame-market-maker", rarity: "legendary", shortLabel: "Maker", source: "case", exclusive: true },
  { key: "monolith_frame", title: "Monolith", cssClass: "mxm-profile-frame-monolith", rarity: "legendary", shortLabel: "Monolith", source: "case", exclusive: true },
  { key: "singularity_frame", title: "Singularity", cssClass: "mxm-profile-frame-singularity", rarity: "legendary", shortLabel: "Singularity", source: "case", exclusive: true },
  { key: "dynasty_frame", title: "Dynasty", cssClass: "mxm-profile-frame-dynasty", rarity: "legendary", shortLabel: "Dynasty", source: "case", exclusive: true },
  { key: "cinder_vault_frame", title: "Cinder Vault", cssClass: "mxm-profile-frame-cinder-vault", rarity: "legendary", shortLabel: "Cinder", source: "case", exclusive: true },
  { key: "meridian_frame", title: "Meridian", cssClass: "mxm-profile-frame-meridian", rarity: "legendary", shortLabel: "Meridian", source: "case", exclusive: true },
];

export const PROFILE_FRAME_CATALOG = Object.fromEntries(
  FRAME_DEFINITIONS.map((frame) => [frame.key, frame]),
) as Record<string, ProfileFrameDefinition>;

export function getProfileFrameDefinition(key: string | null | undefined) {
  if (!key) return null;
  return PROFILE_FRAME_CATALOG[key] || null;
}

export function getProfileFrameClass(key: string | null | undefined) {
  return getProfileFrameDefinition(key)?.cssClass || "mxm-profile-frame-generic";
}
