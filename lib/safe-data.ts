const EPOCH_ISO = new Date(0).toISOString();

export function text(value: unknown, fallback = "", max = 500): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, Math.max(0, max));
  return normalized || fallback;
}

export function nullableText(value: unknown, max = 500): string | null {
  const normalized = text(value, "", max);
  return normalized || null;
}

export function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function safeIsoDate(value: unknown, fallback = EPOCH_ISO): string {
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === "number") date = new Date(value);
  else if (typeof value === "string") date = new Date(value);
  else return fallback;
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

export function safeUnixSeconds(value: unknown): number | null {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === "number") date = new Date(value);
  else if (typeof value === "string") date = new Date(value);
  const time = date?.getTime();
  return typeof time === "number" && Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function relationOne(value: unknown): Record<string, unknown> | null {
  const first = Array.isArray(value) ? value[0] : value;
  return record(first);
}

export function nonEmptyId(value: unknown): string | null {
  const id = text(value, "", 240);
  return id && id !== "undefined" && id !== "null" ? id : null;
}
export function safeDecodeURIComponent(value: unknown, max = 180): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* Next route params may already contain a literal % */ }
  const normalized = decoded.trim().slice(0, Math.max(0, max));
  return normalized || null;
}

