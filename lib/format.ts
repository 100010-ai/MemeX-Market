const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const moneyNumber = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

export function compact(value: number | string | null | undefined) {
  const safe = Number(value || 0);
  if (!Number.isFinite(safe)) return "0";
  const abs = Math.abs(safe);
  if (abs >= 1_000_000_000) return `${number.format(safe / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${number.format(safe / 1_000_000)}M`;
  if (abs >= 1_000) return `${number.format(safe / 1_000)}K`;
  return number.format(safe);
}

export function money(value: number | string | null | undefined, maximumFractionDigits = 2) {
  const safe = Number(value || 0);
  if (!Number.isFinite(safe)) return "0 TON";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits }).format(safe)} TON`;
}

function trimFixed(value: number, decimals: number) {
  return value
    .toFixed(decimals)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");
}

/**
 * Human-readable TON price for market/coin UI.
 * Never returns JS scientific notation because strings such as `1.293e-7`
 * are hard to parse in a trading card and can look like a rendering bug.
 */
export function price(value: number | string | null | undefined) {
  const safe = Number(value || 0);
  if (!Number.isFinite(safe) || safe === 0) return "0 TON";

  const abs = Math.abs(safe);
  if (abs >= 1) return `${moneyNumber.format(safe)} TON`;
  if (abs >= 0.01) return `${trimFixed(safe, 4)} TON`;

  // Keep four significant decimal places after the first non-zero decimal,
  // up to a practical 18-decimal UI ceiling. Example: 1.293e-7 -> 0.0000001293.
  const decimals = Math.min(18, Math.max(6, Math.ceil(-Math.log10(abs)) + 4));
  const rendered = trimFixed(safe, decimals);
  if (Number(rendered) !== 0) return `${rendered} TON`;
  return safe < 0 ? "-<0.000000000000000001 TON" : "<0.000000000000000001 TON";
}

export function percent(value: number | string | null | undefined) {
  const safe = Number(value || 0);
  if (!Number.isFinite(safe)) return "0%";
  return `${safe > 0 ? "+" : ""}${number.format(safe)}%`;
}

export function timeAgo(value: string | null | undefined) {
  if (!value) return "—";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "сейчас";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} д`;
  return new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

// Backward-compatible public name still used by several client components.
// Keep it as a wrapper instead of a const alias so its call signature stays
// stable for static analyzers/Turbopack.
export function ago(value: string | null | undefined) {
  return timeAgo(value);
}

export function rgbIntToHex(value: number | string | null | undefined) {
  const numeric = Number(value);
  const safe = Number.isInteger(numeric) && numeric >= 0 && numeric <= 0xffffff ? numeric : 0;
  return `#${safe.toString(16).padStart(6, "0")}`;
}

export function shortAddress(value: string | null | undefined) {
  const safe = String(value || "").trim();
  if (!safe) return "—";
  if (safe.length <= 15) return safe;
  return `${safe.slice(0, 7)}…${safe.slice(-5)}`;
}
