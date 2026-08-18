import crypto from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "mxm_local_control";
const MAX_AGE = 60 * 60 * 8;

type Payload = { issuedAt: number; nonce: string; tokenHash: string };

function token() {
  const value = process.env.MXM_LOCAL_ADMIN_TOKEN;
  if (!value || value.length < 24) throw new Error("MXM_LOCAL_ADMIN_TOKEN должен содержать минимум 24 символа");
  return value;
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET должен содержать минимум 32 символа");
  return value;
}

function sign(value: string) {
  return crypto.createHmac("sha256", secret()).update(`local-control:${value}`).digest("base64url");
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

export function localControlAvailable(request: Request) {
  return process.env.MXM_LOCAL_ADMIN_ENABLED === "true" && localHost(request) && loopbackRequest(request);
}

export function verifyLocalToken(input: string) {
  const expected = Buffer.from(token());
  const actual = Buffer.from(input);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function createLocalControlSession() {
  const payload: Payload = { issuedAt: Math.floor(Date.now() / 1000), nonce: crypto.randomUUID(), tokenHash: crypto.createHash("sha256").update(token()).digest("hex") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const value = `${encoded}.${sign(encoded)}`;
  const store = await cookies();
  store.set(COOKIE, value, {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearLocalControlSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function hasLocalControlSession(request: Request) {
  if (!localControlAvailable(request)) return false;
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return false;
  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) return false;
  const expected = Buffer.from(sign(encoded));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Payload;
    const now = Math.floor(Date.now() / 1000);
    const currentTokenHash = crypto.createHash("sha256").update(token()).digest("hex");
    return Boolean(payload.nonce && payload.issuedAt && payload.tokenHash === currentTokenHash && now - payload.issuedAt <= MAX_AGE);
  } catch {
    return false;
  }
}

export async function requireLocalControl(request: Request) {
  return hasLocalControlSession(request);
}
