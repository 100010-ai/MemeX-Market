export function money(value: number, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) throw new Error("Cannot format a non-finite monetary value");
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 10_000) return `$${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits }).format(value);
}

export function compact(value: number) {
  if (!Number.isFinite(value)) throw new Error("Cannot format a non-finite number");
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

export function percent(value: number) {
  if (!Number.isFinite(value)) throw new Error("Cannot format a non-finite percentage");
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(Math.abs(value) < 10 ? 2 : 1)}%`;
}

export function price(value: number) {
  if (!Number.isFinite(value)) throw new Error("Cannot format a non-finite price");
  if (value >= 1) return money(value, 4);
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(4)}`;
}

export function ago(input: string) {
  const timestamp = new Date(input).getTime();
  if (!Number.isFinite(timestamp)) throw new Error("Invalid timestamp");
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "сейчас";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} д`;
}

export function rgbIntToHex(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) throw new Error("Invalid Telegram RGB color");
  return `#${value.toString(16).padStart(6, "0")}`;
}
