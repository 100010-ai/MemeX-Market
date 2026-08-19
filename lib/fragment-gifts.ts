export function telegramCollectibleSlug(telegramName: unknown, baseName: unknown, giftNumber: unknown) {
  const stored = String(telegramName || "").trim();
  if (/^[A-Za-z0-9_-]{3,160}-\d{1,12}$/.test(stored)) return stored;

  const base = String(baseName || "").replace(/[^A-Za-z0-9]/g, "");
  const number = Number(giftNumber);
  if (!base || !Number.isSafeInteger(number) || number <= 0) return null;
  return `${base}-${number}`;
}

export function fragmentGiftMedia(slug: string) {
  const normalized = slug.toLowerCase();
  if (!/^[a-z0-9_-]{3,160}-\d{1,12}$/.test(normalized)) return null;
  const base = `https://nft.fragment.com/gift/${normalized}`;
  return {
    animation: `${base}.lottie.json`,
    large: `${base}.large.jpg`,
    medium: `${base}.medium.jpg`,
    small: `${base}.small.jpg`,
  };
}
