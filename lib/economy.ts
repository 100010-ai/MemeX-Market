export const COIN_LAUNCH_FEE_TON = 150;
export const COIN_LAUNCH_COOLDOWN_HOURS = 12;
export const COIN_MAX_ACTIVE_PER_CREATOR = 2;

export const INITIAL_COIN_MARKET_CAP_TON = 100;
export const INITIAL_COIN_AMM_LIQUIDITY_TON = 200;
export const COIN_TRADE_FEE_PERCENT = 0.5;
export const MIN_COIN_BUY_TON = 0.1;
export const MAX_COIN_TRADE_INPUT = 1_000_000_000_000;

export const REFERRAL_BONUS_PERCENT = 5;

export const STAR_PACKAGES = [
  { stars: 50, virtualTon: 750, label: "Старт" },
  { stars: 100, virtualTon: 1600, label: "Буст" },
  { stars: 250, virtualTon: 4250, label: "Трейдер" },
  { stars: 500, virtualTon: 9000, label: "Кит" },
  { stars: 1000, virtualTon: 19000, label: "Магнат" },
] as const;

/** Parse decimal user input consistently across Android/iOS keyboards. */
export function parseEconomyAmount(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Never let UI optimistic state display negative virtual balances. */
export function nonNegativeEconomyValue(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function coinTradeFeeTon(quoteAmount: number) {
  const safe = nonNegativeEconomyValue(quoteAmount);
  return safe * COIN_TRADE_FEE_PERCENT / 100;
}
