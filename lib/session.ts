import crypto from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "mxm_tg_session";

type SessionPayload = {
  telegramId: number;
  issuedAt: number;
};

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return value;
}

function sign(input: string) {
  return crypto.createHmac("sha256", secret()).update(input).digest("base64url");
}

export async function setSession(telegramId: number) {
  const payload: SessionPayload = { telegramId, issuedAt: Math.floor(Date.now() / 1000) };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const value = `${encoded}.${sign(encoded)}`;
  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
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
    if (!payload.telegramId || now - payload.issuedAt > 60 * 60 * 24 * 7) return null;
    return payload;
  } catch {
    return null;
  }
}
