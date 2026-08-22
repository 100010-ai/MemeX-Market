export function normalizePublicAppUrl(raw: string | undefined) {
  const value = String(raw || "").trim().replace(/\/$/, "");
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return "";
    if (!parsed.hostname || parsed.username || parsed.password) return "";
    return parsed.origin + parsed.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function adsgramRewardUrl(appUrl: string, secret: string) {
  const base = normalizePublicAppUrl(appUrl);
  if (!base || !secret) return "";
  return `${base}/api/rewards/ads/adsgram?userid=[userId]&token=${encodeURIComponent(secret)}`;
}
