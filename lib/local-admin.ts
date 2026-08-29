import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { telegramBotApi } from "@/lib/telegram-bot";

const COOKIE = "mxm_control_v210";
const MAX_AGE = 60 * 60 * 8;
const CODE_TTL_SECONDS = 7 * 60;
const SECRET_FILE = ".mxm-control-secret";
const MAX_CODE_ATTEMPTS = 6;
const MAX_CODE_REQUESTS_10M = 5;

type Payload = {
  issuedAt: number;
  nonce: string;
  telegramId: string;
  mode: "telegram" | "local";
};

export type ControlSession = {
  telegramId: string;
  mode: "telegram" | "local";
  issuedAt: number;
};

let cachedLocalToken: string | null = null;

function adminTelegramIds() {
  return new Set(
    String(process.env.ADMIN_TELEGRAM_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^\d{4,20}$/.test(value)),
  );
}

function configuredSessionSecret() {
  const value = String(process.env.SESSION_SECRET || "").trim();
  return value.length >= 32 ? value : null;
}

export function browserControlConfigured() {
  return Boolean(
    configuredSessionSecret() &&
      String(process.env.TELEGRAM_BOT_TOKEN || "").trim() &&
      adminTelegramIds().size,
  );
}

function tokenFilePath() {
  return path.join(process.cwd(), SECRET_FILE);
}

function localToken() {
  if (cachedLocalToken) return cachedLocalToken;
  const file = tokenFilePath();
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 24) {
      cachedLocalToken = existing;
      return existing;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const generated = crypto.randomBytes(32).toString("base64url");
  try {
    fs.writeFileSync(file, `${generated}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    cachedLocalToken = generated;
    console.info(`\n[MXM Control] Локальный ключ создан: ${generated}\n[MXM Control] Сохранён в ${file}\n`);
    return generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length < 24) throw new Error(".mxm-control-secret повреждён; удалите файл и перезапустите dev server");
    cachedLocalToken = existing;
    return existing;
  }
}

function signingSecret() {
  const configured = configuredSessionSecret();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return localToken();
  throw new Error("SESSION_SECRET не настроен для Control Center");
}

function sign(value: string) {
  return crypto.createHmac("sha256", signingSecret()).update(`control-v210:${value}`).digest("base64url");
}

function codeHash(telegramId: string, code: string) {
  return crypto
    .createHmac("sha256", signingSecret())
    .update(`control-code:${telegramId}:${code}`)
    .digest("hex");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function localHost(request: Request) {
  const raw = (request.headers.get("host") || "").toLowerCase();
  const host = raw.startsWith("[") ? raw.slice(1, raw.indexOf("]")) : raw.split(":")[0];
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function loopbackRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!forwarded) return true;
  return forwarded === "127.0.0.1" || forwarded === "::1" || forwarded === "::ffff:127.0.0.1";
}

function localDevAvailable(request: Request) {
  return process.env.NODE_ENV !== "production" && localHost(request) && loopbackRequest(request);
}

export function localControlAvailable(request: Request) {
  return browserControlConfigured() || localDevAvailable(request);
}

export function localControlKeyPath() {
  return tokenFilePath();
}

export function ensureLocalControlKey() {
  if (process.env.NODE_ENV !== "production") localToken();
}

export function verifyLocalToken(input: string) {
  if (process.env.NODE_ENV === "production") return false;
  return safeEqual(localToken(), String(input || ""));
}

export async function requestControlLoginCode(rawTelegramId: unknown) {
  if (!browserControlConfigured()) throw new Error("Браузерный вход Control Center не настроен");
  const telegramId = String(rawTelegramId || "").trim();
  if (!/^\d{4,20}$/.test(telegramId) || !adminTelegramIds().has(telegramId)) {
    throw new Error("Этот Telegram ID не имеет доступа к Control Center");
  }

  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const recent = await supabase
    .from("control_login_challenges_v210")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", Number(telegramId))
    .gte("created_at", since);
  if (recent.error) throw recent.error;
  if (Number(recent.count || 0) >= MAX_CODE_REQUESTS_10M) {
    throw new Error("Слишком много кодов входа. Подождите несколько минут.");
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();
  const inserted = await supabase
    .from("control_login_challenges_v210")
    .insert({ telegram_id: Number(telegramId), code_hash: codeHash(telegramId, code), expires_at: expiresAt })
    .select("id")
    .single();
  if (inserted.error) throw inserted.error;

  try {
    await telegramBotApi("sendMessage", {
      chat_id: telegramId,
      text: `<b>MXM Control Center</b>\n\nКод входа: <code>${code}</code>\nДействует 7 минут. Никому его не отправляйте.`,
      parse_mode: "HTML",
      disable_notification: false,
    });
  } catch (error) {
    await supabase.from("control_login_challenges_v210").delete().eq("id", inserted.data.id);
    throw error;
  }

  return { telegramId, expiresAt };
}

export async function verifyControlLoginCode(rawTelegramId: unknown, rawCode: unknown) {
  if (!browserControlConfigured()) return false;
  const telegramId = String(rawTelegramId || "").trim();
  const code = String(rawCode || "").trim();
  if (!/^\d{4,20}$/.test(telegramId) || !/^\d{6}$/.test(code) || !adminTelegramIds().has(telegramId)) return false;

  const supabase = getSupabaseAdmin();
  const challenge = await supabase
    .from("control_login_challenges_v210")
    .select("id,code_hash,attempts,expires_at")
    .eq("telegram_id", Number(telegramId))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (challenge.error) throw challenge.error;
  if (!challenge.data || Number(challenge.data.attempts || 0) >= MAX_CODE_ATTEMPTS) return false;

  const valid = safeEqual(String(challenge.data.code_hash), codeHash(telegramId, code));
  if (!valid) {
    await supabase
      .from("control_login_challenges_v210")
      .update({ attempts: Number(challenge.data.attempts || 0) + 1 })
      .eq("id", challenge.data.id);
    return false;
  }

  const used = await supabase
    .from("control_login_challenges_v210")
    .update({ used_at: new Date().toISOString() })
    .eq("id", challenge.data.id)
    .is("used_at", null);
  if (used.error) throw used.error;
  return true;
}

export async function createLocalControlSession(telegramId = "local") {
  const mode: Payload["mode"] = telegramId === "local" ? "local" : "telegram";
  if (mode === "telegram" && !adminTelegramIds().has(telegramId)) throw new Error("Администратор не разрешён");
  const payload: Payload = {
    issuedAt: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
    telegramId,
    mode,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const value = `${encoded}.${sign(encoded)}`;
  const store = await cookies();
  store.set(COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearLocalControlSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getControlSession(request: Request): Promise<ControlSession | null> {
  if (!localControlAvailable(request)) return null;
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature || !safeEqual(signature, sign(encoded))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Payload;
    const now = Math.floor(Date.now() / 1000);
    if (!payload.nonce || !payload.issuedAt || now - payload.issuedAt > MAX_AGE) return null;
    if (payload.mode === "telegram") {
      if (!adminTelegramIds().has(String(payload.telegramId))) return null;
    } else if (!localDevAvailable(request)) {
      return null;
    }
    return { telegramId: String(payload.telegramId), mode: payload.mode, issuedAt: payload.issuedAt };
  } catch {
    return null;
  }
}

export async function hasLocalControlSession(request: Request) {
  return Boolean(await getControlSession(request));
}

export async function requireLocalControl(request: Request) {
  return hasLocalControlSession(request);
}
