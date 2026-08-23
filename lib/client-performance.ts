export type ClientPerformanceProfile = {
  constrained: boolean;
  saveData: boolean;
  effectiveType: string;
  deviceMemory: number | null;
  hardwareConcurrency: number;
  reducedMotion: boolean;
};

type NavigatorWithHints = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

export function getClientPerformanceProfile(): ClientPerformanceProfile {
  if (typeof navigator === "undefined") {
    return { constrained: false, saveData: false, effectiveType: "", deviceMemory: null, hardwareConcurrency: 8, reducedMotion: false };
  }
  const device = navigator as NavigatorWithHints;
  const saveData = Boolean(device.connection?.saveData);
  const effectiveType = String(device.connection?.effectiveType || "");
  const deviceMemory = Number.isFinite(device.deviceMemory) ? Number(device.deviceMemory) : null;
  const hardwareConcurrency = Math.max(1, Number(navigator.hardwareConcurrency || 8));
  const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const constrained = Boolean(
    saveData
    || effectiveType.includes("2g")
    || (deviceMemory != null && deviceMemory <= 4)
    || hardwareConcurrency <= 4
  );
  return { constrained, saveData, effectiveType, deviceMemory, hardwareConcurrency, reducedMotion };
}

export function adaptiveListPageSize(normal = 24, constrained = 16) {
  return getClientPerformanceProfile().constrained ? constrained : normal;
}

export function shouldUseRichMotion() {
  const profile = getClientPerformanceProfile();
  return !profile.constrained && !profile.reducedMotion;
}
