export const COIN_LAUNCH_FEE_TON = 150;
export const COIN_LAUNCH_COOLDOWN_HOURS = 12;
export const COIN_MAX_ACTIVE_PER_CREATOR = 2;

export const REWARDED_AD_REWARD_TON = 1;
export const REWARDED_AD_DAILY_LIMIT = 3;
export const REWARDED_AD_COOLDOWN_MINUTES = 30;

export const INITIAL_COIN_MARKET_CAP_TON = 100;
export const INITIAL_COIN_AMM_LIQUIDITY_TON = 200;
export const COIN_TRADE_FEE_PERCENT = 0.5;

// Games are disabled in the current product, but these are kept for rolling-deploy compatibility.
export const GAME_MIN_BET_TON = 0.1;
export const GAME_MAX_BET_TON = 100;

export const REFERRAL_BONUS_PERCENT = 5;
export const STAR_PACKAGES = [
  { stars: 50, virtualTon: 750, label: "Старт" },
  { stars: 100, virtualTon: 1600, label: "Буст" },
  { stars: 250, virtualTon: 4250, label: "Трейдер" },
  { stars: 500, virtualTon: 9000, label: "Кит" },
  { stars: 1000, virtualTon: 19000, label: "Магнат" },
] as const;
