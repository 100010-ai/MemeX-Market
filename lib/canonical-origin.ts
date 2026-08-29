function normalizeOrigin(value: string | undefined | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getCanonicalOrigin() {
  return (
    normalizeOrigin(process.env.APP_CANONICAL_URL) ||
    normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL) ||
    normalizeOrigin(process.env.NEXT_PUBLIC_TELEGRAM_APP_URL)
  );
}

export function getCanonicalHost() {
  const origin = getCanonicalOrigin();
  if (!origin) return null;

  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}
