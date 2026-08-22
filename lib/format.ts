function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function decimal(value: number, maximumFractionDigits: number, minimumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", { useGrouping: true, maximumFractionDigits, minimumFractionDigits }).format(finite(value));
}

/** UI formatter: malformed remote values must never crash a React render. */
export function money(value: number, maximumFractionDigits = 2) {
  const safe = finite(value);
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B TON`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M TON`;
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(1)}K TON`;
  return `${decimal(safe, maximumFractionDigits)} TON`;
}

export function compact(value: number) {
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 2 }).format(finite(value));
}

export function percent(value: number) {
  const safe = finite(value);
  const sign = safe > 0 ? "+" : "";
  return `${sign}${safe.toFixed(Math.abs(safe) < 10 ? 2 : 1)}%`;
}

export function price(value: number) {
  const safe = finite(value);
  if (safe >= 1) return money(safe, 4);
  if (safe >= 0.01) return `${safe.toFixed(4)} TON`;
  if (safe > 0) return `${safe.toPrecision(4)} TON`;
  return "0 TON";
}

export function ago(input: string) {
  const timestamp = new Date(input).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "сейчас";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} д`;
}

export function rgbIntToHex(value: number) {
  const safe = Number.isInteger(value) && value >= 0 && value <= 0xffffff ? value : 0;
  return `#${safe.toString(16).padStart(6, "0")}`;
}
