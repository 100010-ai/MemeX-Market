import type { CoinQuote } from "@/lib/types";

export const COIN_FEE_RATE = 0.005;

function roundFee(value: number) {
  return Number(value.toFixed(8));
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
  const feeRate = Number.isFinite(args.feeRate) && Number(args.feeRate) >= 0 && Number(args.feeRate) < 1 ? Number(args.feeRate) : COIN_FEE_RATE;
  if (![amount, tokenReserve, quoteReserve, currentPrice].every(Number.isFinite)) return null;
  if (amount <= 0 || tokenReserve <= 0 || quoteReserve <= 0 || currentPrice <= 0) return null;

  const k = tokenReserve * quoteReserve;
  if (!Number.isFinite(k) || k <= 0) return null;

  if (side === "buy") {
    const feeAmount = roundFee(amount * feeRate);
    const quoteNet = amount - feeAmount;
    const newQuote = quoteReserve + quoteNet;
    const newToken = k / newQuote;
    const outputAmount = tokenReserve - newToken;
    if (!Number.isFinite(outputAmount) || outputAmount <= 0) return null;
    const executionPrice = amount / outputAmount;
    const projectedPrice = newQuote / newToken;
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

  const newToken = tokenReserve + amount;
  const newQuote = k / newToken;
  const projectedPrice = newQuote / newToken;
  const floorPrice = Number(args.floorPrice);
  if (args.floorActive === true && Number.isFinite(floorPrice) && floorPrice > 0 && projectedPrice < floorPrice) return null;
  const quoteGross = quoteReserve - newQuote;
  const feeAmount = roundFee(quoteGross * feeRate);
  const outputAmount = quoteGross - feeAmount;
  if (!Number.isFinite(outputAmount) || outputAmount < 0.000001) return null;
  const executionPrice = outputAmount / amount;
  return {
    side,
    inputAmount: amount,
    outputAmount,
    executionPrice,
    currentPrice,
    priceImpact: Math.max(0, (1 - (executionPrice / currentPrice)) * 100),
    feeAmount,
    projectedPrice,
  };
}
