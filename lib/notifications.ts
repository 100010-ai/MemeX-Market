export const notificationPreferenceKeys = [
  "gift_sold",
  "gift_offer",
  "offer_resolved",
  "price_alert",
  "coin_move",
  "referral_reward",
  "promo",
  "telegram_push",
] as const;

export type NotificationPreferenceKey = (typeof notificationPreferenceKeys)[number];
export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;

export const defaultNotificationPreferences: NotificationPreferences = {
  gift_sold: true,
  gift_offer: true,
  offer_resolved: true,
  price_alert: true,
  coin_move: false,
  referral_reward: true,
  promo: true,
  telegram_push: true,
};

export function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const normalized: NotificationPreferences = { ...defaultNotificationPreferences };
  for (const key of notificationPreferenceKeys) {
    if (typeof source[key] === "boolean") normalized[key] = source[key];
  }
  return normalized;
}

/** Notifications only navigate inside the Mini App. */
export function normalizeNotificationHref(value: unknown) {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  return href.slice(0, 500);
}
