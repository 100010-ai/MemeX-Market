export type ProfileFrameDefinition = {
  key: string;
  title: string;
  cssClass: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  shortLabel: string;
  assetSrc?: string;
  motion?: "drift" | "pulse" | "scan";
  exclusive?: boolean;
};

const FRAME_DEFINITIONS: ProfileFrameDefinition[] = [
  { key: "carbon_frame", title: "Carbon Black", cssClass: "mxm-profile-frame-carbon", rarity: "common", shortLabel: "Carbon" },
  { key: "chrome_frame", title: "Liquid Chrome", cssClass: "mxm-profile-frame-chrome", rarity: "rare", shortLabel: "Chrome" },
  { key: "frost_frame", title: "Arctic Frost", cssClass: "mxm-profile-frame-frost", rarity: "rare", shortLabel: "Frost" },
  { key: "sunset_frame", title: "Solar Sunset", cssClass: "mxm-profile-frame-sunset", rarity: "epic", shortLabel: "Sunset" },
  { key: "aurora_frame", title: "Aurora Glass", cssClass: "mxm-profile-frame-aurora", rarity: "epic", shortLabel: "Aurora" },
  { key: "royal_frame", title: "Royal Gold", cssClass: "mxm-profile-frame-royal", rarity: "legendary", shortLabel: "Royal" },
  { key: "void_frame", title: "Deep Space", cssClass: "mxm-profile-frame-void", rarity: "legendary", shortLabel: "Void" },
  { key: "founder_frame", title: "Founder Edition", cssClass: "mxm-profile-frame-founder", rarity: "legendary", shortLabel: "Founder" },
  // Backward-compatible visual for accounts that already bought the original frame.
  { key: "neon_frame", title: "Spectrum Legacy", cssClass: "mxm-profile-frame-spectrum", rarity: "epic", shortLabel: "Spectrum" },
  // Season-only frames.
  { key: "season_rift_frame", title: "Season Rift", cssClass: "mxm-profile-frame-rift", rarity: "epic", shortLabel: "Rift" },
  { key: "season_master_frame", title: "Season Master", cssClass: "mxm-profile-frame-master", rarity: "legendary", shortLabel: "Master" },
  { key: "account_vanguard_frame", title: "Vanguard 100", cssClass: "mxm-profile-frame-vanguard", rarity: "legendary", shortLabel: "Vanguard" },
  { key: "season_prestige_frame", title: "Prestige Orbit", cssClass: "mxm-profile-frame-prestige", rarity: "legendary", shortLabel: "Prestige" },
  { key: "glacier_crown_frame", title: "Glacier Crown", cssClass: "mxm-profile-frame-asset", rarity: "legendary", shortLabel: "Glacier", assetSrc: "/assets/season/frame-glacier-crown.png", motion: "drift", exclusive: true },
  { key: "vault_sovereign_frame", title: "Vault Sovereign", cssClass: "mxm-profile-frame-asset", rarity: "legendary", shortLabel: "Sovereign", assetSrc: "/assets/season/frame-vault-sovereign.png", motion: "pulse", exclusive: true },
  { key: "obsidian_signal_frame", title: "Obsidian Signal", cssClass: "mxm-profile-frame-asset", rarity: "epic", shortLabel: "Obsidian", assetSrc: "/assets/season/frame-obsidian-signal.png", motion: "scan", exclusive: true },
  { key: "circuit_elite_frame", title: "Circuit Elite", cssClass: "mxm-profile-frame-asset", rarity: "epic", shortLabel: "Circuit", assetSrc: "/assets/season/frame-circuit-elite.png", motion: "scan", exclusive: true },
  { key: "iron_regent_frame", title: "Iron Regent", cssClass: "mxm-profile-frame-asset", rarity: "legendary", shortLabel: "Regent", assetSrc: "/assets/season/frame-iron-regent.png", motion: "pulse", exclusive: true },
  { key: "arctic_relay_frame", title: "Arctic Relay", cssClass: "mxm-profile-frame-asset", rarity: "epic", shortLabel: "Relay", assetSrc: "/assets/season/frame-arctic-relay.png", motion: "drift", exclusive: true },
  { key: "ember_sentinel_frame", title: "Ember Sentinel", cssClass: "mxm-profile-frame-asset", rarity: "legendary", shortLabel: "Ember", assetSrc: "/assets/season/frame-ember-sentinel.png", motion: "pulse", exclusive: true },
  { key: "quantum_frost_frame", title: "Quantum Frost", cssClass: "mxm-profile-frame-asset", rarity: "legendary", shortLabel: "Quantum", assetSrc: "/assets/season/frame-quantum-frost.png", motion: "scan", exclusive: true },
  { key: "midnight_laurels_frame", title: "Midnight Laurels", cssClass: "mxm-profile-frame-asset", rarity: "legendary", shortLabel: "Laurels", assetSrc: "/assets/season/frame-midnight-laurels.png", motion: "drift", exclusive: true },
  { key: "league_challenger_frame", title: "League Challenger", cssClass: "mxm-profile-frame-asset", rarity: "epic", shortLabel: "Challenger", assetSrc: "/assets/league/frame-challenger.png", motion: "drift", exclusive: true },
  { key: "league_apex_frame", title: "League Apex", cssClass: "mxm-profile-frame-asset", rarity: "legendary", shortLabel: "Apex", assetSrc: "/assets/league/frame-apex.png", motion: "scan", exclusive: true },
  { key: "league_founder_frame", title: "League Founder", cssClass: "mxm-profile-frame-asset", rarity: "legendary", shortLabel: "Founder", assetSrc: "/assets/league/frame-founder.png", motion: "pulse", exclusive: true },
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
