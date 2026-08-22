import crypto from "node:crypto";

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
};

export function validateTelegramInitData(initData: string, botToken: string, maxAgeSeconds = 86_400) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) return { ok: false as const, reason: "Missing hash" };

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(calculatedHash, "hex");
  const b = Buffer.from(receivedHash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false as const, reason: "Invalid hash" };
  }

  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > maxAgeSeconds || authDate > now + 60) {
    return { ok: false as const, reason: "Expired initData" };
  }

  const rawUser = params.get("user");
  if (!rawUser) return { ok: false as const, reason: "Missing user" };

  try {
    const parsed = JSON.parse(rawUser) as Partial<TelegramUser> | null;
    const id = Number(parsed?.id);
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false as const, reason: "Invalid user" };
    const clean = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
    const user: TelegramUser = {
      id,
      first_name: clean(parsed?.first_name) || "Telegram User",
      ...(typeof parsed?.is_bot === "boolean" ? { is_bot: parsed.is_bot } : {}),
      ...(clean(parsed?.last_name) ? { last_name: clean(parsed?.last_name) } : {}),
      ...(clean(parsed?.username) ? { username: clean(parsed?.username) } : {}),
      ...(clean(parsed?.language_code) ? { language_code: clean(parsed?.language_code) } : {}),
      ...(clean(parsed?.photo_url) ? { photo_url: clean(parsed?.photo_url) } : {}),
    };
    return { ok: true as const, user, authDate, startParam: params.get("start_param") };
  } catch {
    return { ok: false as const, reason: "Invalid user payload" };
  }
}
