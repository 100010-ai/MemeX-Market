function truthy(value: string | undefined) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function explicitlyFalse(value: string | undefined) {
  return /^(0|false|no|off)$/i.test(String(value || "").trim());
}

/**
 * Safe-by-default mode for the production build submitted to AdsGram.
 * It stays enabled unless explicitly disabled after moderation/approval.
 */
export function adsgramModerationMode() {
  return !explicitlyFalse(process.env.ADSGRAM_MODERATION_MODE);
}

/**
 * Incentivized third-party subscription/click campaigns stay unavailable while
 * AdsGram moderation mode is enabled, even if ENABLE_SPONSORED_TASKS=true.
 */
export function sponsoredTasksEnabled() {
  return !adsgramModerationMode() && truthy(process.env.ENABLE_SPONSORED_TASKS);
}
