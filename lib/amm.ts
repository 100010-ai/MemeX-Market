import type { CoinQuote } from "@/lib/types";

export const COIN_FEE_RATE = 0.005;
export const MAX_FEE_RATE = 0.25;

function roundFee(value: number) {
  return Number(value.toFixed(8));
}

function validPositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

function normalizeFee(value?: number) {
  if (!Number.isFinite(value)) return COIN_FEE_RATE;
  return Math.min(Math.max(Number(value), 0), MAX_FEE_RATE);
}

export function getPoolPrice(tokenReserve: number, quoteReserve: number) {
  if (!validPositive(tokenReserve) || !validPositive(quoteReserve)) return 0;
  return quoteReserve / tokenReserve;
}

export function calculateCoinQuote(args: {
  side: "buy" | "sell";
  amount: number;
  tokenReserve: number;
  quoteReserve: number;
  currentPrice: number;
  feeRate?: number;
  floorPrice?: number | null;
  floorActive?: boolean;
}): CoinQuote | null {
  const { side, amount, tokenReserve, quoteReserve, currentPrice } = args;
  const feeRate = normalizeFee(args.feeRate);

  if (![amount, tokenReserve, quoteReserve, currentPrice].every(Number.isFinite)) return null;
  if (!validPositive(amount) || !validPositive(tokenReserve) || !validPositive(quoteReserve)) return null;

  const k = tokenReserve * quoteReserve;
  if (!Number.isFinite(k) || k <= 0) return null;

  if (side === "buy") {
    const feeAmount = roundFee(amount * feeRate);
    const netQuote = amount - feeAmount;
    const newQuoteReserve = quoteReserve + netQuote;
    const newTokenReserve = k / newQuoteReserve;
    const outputAmount = tokenReserve - newTokenReserve;

    if (!validPositive(outputAmount)) return null;

    const executionPrice = amount / outputAmount;
    const projectedPrice = getPoolPrice(newTokenReserve, newQuoteReserve);

    return {
      side,
      inputAmount: amount,
      outputAmount,
      executionPrice,
      currentPrice,
      priceImpact: Math.max(0, ((executionPrice / currentPrice) - 1) * 100),
      feeAmount,
      projectedPrice,
    };
  }

  const newTokenReserve = tokenReserve + amount;
  const newQuoteReserve = k / newTokenReserve;
  const projectedPrice = getPoolPrice(newTokenReserve, newQuoteReserve);

  const floorPrice = Number(args.floorPrice);
  if (args.floorActive && Number.isFinite(floorPrice) && floorPrice > 0 && projectedPrice < floorPrice) {
    return null;
  }

  const grossOutput = quoteReserve - newQuoteReserve;
  const feeAmount = roundFee(grossOutput * feeRate);
  const outputAmount = grossOutput - feeAmount;

  if (!validPositive(outputAmount)) return null;

  const executionPrice = outputAmount / amount;

  return {
    side,
    inputAmount: amount,
    outputAmount,
    executionPrice,
    currentPrice,
    priceImpact: Math.max(0, (1 - executionPrice / currentPrice) * 100),
    feeAmount,
    projectedPrice,
  };
}

export function calculateMarketCap(supply: number, price: number) {
  if (!validPositive(supply) || !validPositive(price)) return 0;
  return supply * price;
}
