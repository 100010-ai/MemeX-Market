import crypto from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "mxm_tg_session";

type SessionPayload = {
  version?: number;
  telegramId: number;
  issuedAt: number;
  inspector?: boolean;
};

type SessionOptions = {
  inspector?: boolean;
  maxAgeSeconds?: number;
};

export function getSessionConfigStatus() {
  const value = process.env.SESSION_SECRET;
  return { configured: Boolean(value && value.length >= 32) };
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET должен содержать минимум 32 символа");
  return value;
}

function sign(input: string) {
  return crypto.createHmac("sha256", secret()).update(input).digest("base64url");
}

export async function setSession(telegramId: number, options: SessionOptions = {}) {
  const maxAge = Math.max(300, Math.min(60 * 60 * 24 * 7, Math.floor(options.maxAgeSeconds ?? 60 * 60 * 24 * 7)));
  const payload: SessionPayload = {
    version: 2,
    telegramId,
    issuedAt: Math.floor(Date.now() / 1000),
    inspector: options.inspector === true || undefined,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const value = `${encoded}.${sign(encoded)}`;
  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const value = store.get(COOKIE_NAME)?.value;
  if (!value) return null;

  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(payload.telegramId) || payload.telegramId <= 0) return null;
    if (!Number.isFinite(payload.issuedAt) || payload.issuedAt <= 0 || payload.issuedAt > now + 300) return null;
    const maxLifetime = payload.inspector ? 60 * 60 * 2 : 60 * 60 * 24 * 7;
    if (now - payload.issuedAt > maxLifetime) return null;
    if (payload.inspector && process.env.VERCEL_ENV !== "preview" && process.env.NODE_ENV !== "development") return null;
    return payload;
  } catch {
    return null;
  }
}

export async function isInspectionSession() {
  return (await readSession())?.inspector === true;
}
