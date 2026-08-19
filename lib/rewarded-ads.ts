import { timingSafeEqual } from "node:crypto";

export type RewardVerificationMode = "server" | "client" | "disabled";

export function rewardedAdsConfig() {
  const rawBlockId = String(process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID || "").trim();
  const rawServerSecret = String(process.env.ADSGRAM_REWARD_SECRET || "").trim();
  const blockId = /^\d+$/.test(rawBlockId) ? rawBlockId : "";
  const serverSecret = rawServerSecret.length >= 32 ? rawServerSecret : "";
  const fallbackRequested = String(process.env.ADSGRAM_ALLOW_CLIENT_FALLBACK || "").trim().toLowerCase() === "true";
  // Client-only confirmation can be replayed/forged by a modified web client.
  // Keep it available only for local/dev testing and require Reward URL in production.
  const allowClientFallback = process.env.NODE_ENV !== "production" && fallbackRequested;
  const verificationMode: RewardVerificationMode = serverSecret ? "server" : allowClientFallback ? "client" : "disabled";
  return {
    blockId,
    serverSecret,
    allowClientFallback,
    verificationMode,
    configured: Boolean(blockId) && verificationMode !== "disabled",
    configurationError: rawBlockId && !blockId
      ? "Некорректный AdsGram Block ID"
      : rawServerSecret && !serverSecret
        ? "ADSGRAM_REWARD_SECRET должен содержать минимум 32 символа"
        : null,
  };
}

export function safeSecretEquals(actual: string, expected: string) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
