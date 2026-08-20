const TELEGRAM_USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;

function normalizeTelegramUsername(value: string | undefined) {
  return String(value || "").trim().replace(/^@+/, "");
}

export function getHumanSupportUsername() {
  const username = normalizeTelegramUsername(process.env.SUPPORT_TELEGRAM_USERNAME);
  const botUsername = normalizeTelegramUsername(process.env.NEXT_PUBLIC_BOT_USERNAME);
  if (!TELEGRAM_USERNAME_PATTERN.test(username)) return null;
  if (botUsername && username.toLowerCase() === botUsername.toLowerCase()) return null;
  return username;
}

export function humanSupportTelegramUrl(username: string) {
  return `https://t.me/${encodeURIComponent(username)}`;
}
