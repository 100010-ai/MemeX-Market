/** Only Telegram-owned avatar URLs are proxied. Other URLs are rejected. */
export function telegramAvatarProxyUrl(value: string | null | undefined) {
  if (!value || typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "t.me" || !url.pathname.startsWith("/i/userpic/")) return null;
    return `/api/telegram/avatar?url=${encodeURIComponent(url.toString())}`;
  } catch {
    return null;
  }
}
