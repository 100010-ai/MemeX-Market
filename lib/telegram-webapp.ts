export type TelegramWebAppVersioned = {
  version?: string;
  isVersionAtLeast?: (version: string) => boolean;
};

function versionParts(value: string | null | undefined) {
  return String(value || "0")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => Number.isFinite(part) && part >= 0 ? part : 0);
}

export function telegramVersionAtLeast(webApp: TelegramWebAppVersioned | null | undefined, minimum: string) {
  if (!webApp) return false;
  if (typeof webApp.isVersionAtLeast === "function") {
    try { return webApp.isVersionAtLeast(minimum); } catch { /* fall back to local comparison */ }
  }
  const current = versionParts(webApp.version);
  const target = versionParts(minimum);
  const length = Math.max(current.length, target.length);
  for (let index = 0; index < length; index += 1) {
    const left = current[index] || 0;
    const right = target[index] || 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}
