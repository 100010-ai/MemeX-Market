export type TelegramWebAppVersioned = {
  version?: string;
  isVersionAtLeast?: (version: string) => boolean;
};

export type TelegramWebAppFeature =
  | "colors"
  | "backButton"
  | "haptics"
  | "invoice"
  | "telegramLink"
  | "closingConfirmation"
  | "settingsButton"
  | "safeArea"
  | "activationEvent";

const FEATURE_MIN_VERSION: Record<TelegramWebAppFeature, string> = {
  colors: "6.1",
  backButton: "6.1",
  haptics: "6.1",
  invoice: "6.1",
  telegramLink: "6.1",
  closingConfirmation: "6.2",
  settingsButton: "6.10",
  safeArea: "8.0",
  activationEvent: "8.0",
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

export function telegramSupports(webApp: TelegramWebAppVersioned | null | undefined, feature: TelegramWebAppFeature) {
  return telegramVersionAtLeast(webApp, FEATURE_MIN_VERSION[feature]);
}

export function telegramCapabilitySnapshot(webApp: TelegramWebAppVersioned | null | undefined) {
  return {
    version: String(webApp?.version || "0"),
    colors: telegramSupports(webApp, "colors"),
    backButton: telegramSupports(webApp, "backButton"),
    haptics: telegramSupports(webApp, "haptics"),
    invoice: telegramSupports(webApp, "invoice"),
    telegramLink: telegramSupports(webApp, "telegramLink"),
    closingConfirmation: telegramSupports(webApp, "closingConfirmation"),
    settingsButton: telegramSupports(webApp, "settingsButton"),
    safeArea: telegramSupports(webApp, "safeArea"),
    activationEvent: telegramSupports(webApp, "activationEvent"),
  };
}


type TelegramLinkWebApp = TelegramWebAppVersioned & { openTelegramLink?: (url: string) => void };

/** Open a t.me link without triggering Telegram SDK warnings on old WebApp versions. */
export function openTelegramLinkSafely(url: string) {
  if (typeof window === "undefined") return false;
  const webApp = window.Telegram?.WebApp as TelegramLinkWebApp | undefined;
  if (telegramSupports(webApp, "telegramLink") && typeof webApp?.openTelegramLink === "function") {
    try { webApp.openTelegramLink(url); return true; } catch { /* browser fallback below */ }
  }
  window.open(url, "_blank", "noopener,noreferrer");
  return false;
}
