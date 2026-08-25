import crypto from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "mxm_admin_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

type AdminSessionPayload = {
  version: 2;
  telegramId: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

export function configuredOwnerTelegramId() {
  const value = Number(process.env.ADMIN_OWNER_TELEGRAM_ID);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function signingSecret() {
  const sessionSecret = process.env.SESSION_SECRET?.trim() || "";
  const ownerKey = process.env.ADMIN_OWNER_KEY?.trim() || "";
  if (sessionSecret.length < 32 || ownerKey.length < 32) return null;
  const keyVersion = crypto.createHash("sha256").update(ownerKey).digest("hex");
  return `${sessionSecret}:admin-owner:${keyVersion}`;
}

function sign(input: string) {
  const secret = signingSecret();
  return secret ? crypto.createHmac("sha256", secret).update(input).digest("base64url") : null;
}

export function getAdminOwnerConfigStatus() {
  return {
    configured: Boolean(signingSecret() && configuredOwnerTelegramId()),
    hasOwnerId: Boolean(configuredOwnerTelegramId()),
    hasOwnerKey: Boolean(process.env.ADMIN_OWNER_KEY && process.env.ADMIN_OWNER_KEY.trim().length >= 32),
  };
}

export async function setAdminSession(telegramId: number) {
  const ownerId = configuredOwnerTelegramId();
  const issuedAt = Math.floor(Date.now() / 1000);
  if (!ownerId || telegramId !== ownerId || !signingSecret()) throw new Error("Вход владельца не настроен");
  const payload: AdminSessionPayload = {
    version: 2,
    telegramId,
    issuedAt,
    expiresAt: issuedAt + MAX_AGE_SECONDS,
    nonce: crypto.randomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encoded);
  if (!signature) throw new Error("Вход владельца не настроен");
  (await cookies()).set(COOKIE_NAME, `${encoded}.${signature}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearAdminSession() {
  (await cookies()).set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

export async function readAdminSession(): Promise<AdminSessionPayload | null> {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  if (!value) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  if (!expected) return null;
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AdminSessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.version !== 2 || payload.telegramId !== configuredOwnerTelegramId()) return null;
    if (!Number.isSafeInteger(payload.issuedAt) || payload.issuedAt <= 0 || payload.issuedAt > now + 300) return null;
    if (!Number.isSafeInteger(payload.expiresAt) || payload.expiresAt !== payload.issuedAt + MAX_AGE_SECONDS || payload.expiresAt <= now) return null;
    if (typeof payload.nonce !== "string" || !/^[A-Za-z0-9_-]{20,32}$/.test(payload.nonce)) return null;
    return payload;
  } catch {
    return null;
  }
}
