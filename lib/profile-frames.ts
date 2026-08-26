export type ProfileFrameDefinition = {
  key: string;
  title: string;
  cssClass: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  shortLabel: string;
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
