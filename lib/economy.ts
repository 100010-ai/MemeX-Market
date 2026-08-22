export const COIN_LAUNCH_FEE_TON = 150;
export const COIN_LAUNCH_COOLDOWN_HOURS = 12;
export const COIN_MAX_ACTIVE_PER_CREATOR = 2;

export const INITIAL_COIN_MARKET_CAP_TON = 100;
export const INITIAL_COIN_AMM_LIQUIDITY_TON = 200;
export const COIN_TRADE_FEE_PERCENT = 0.5;

export const REFERRAL_BONUS_PERCENT = 5;

export const STAR_PACKAGES = [
  { stars: 50, virtualTon: 750, label: "Старт" },
  { stars: 100, virtualTon: 1600, label: "Буст" },
  { stars: 250, virtualTon: 4250, label: "Трейдер" },
  { stars: 500, virtualTon: 9000, label: "Кит" },
  { stars: 1000, virtualTon: 19000, label: "Магнат" },
] as const;
