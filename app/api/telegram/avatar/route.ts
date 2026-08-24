import { withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { readResponseBytesLimited, toBodyArrayBuffer } from "@/lib/http-body";

export const runtime = "nodejs";

const MAX_REDIRECTS = 3;
const fallbackSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#15191f"/><circle cx="32" cy="25" r="11" fill="#69727d"/><path d="M13 57c2-13 10-20 19-20s17 7 19 20" fill="#69727d"/></svg>';

function fallback() {
  return new NextResponse(fallbackSvg, { status: 200, headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600", "x-content-type-options": "nosniff" } });
}

function trustedAvatarHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "t.me"
    || host === "telegram-cdn.org" || host.endsWith(".telegram-cdn.org")
    || host === "cdn-telegram.org" || host.endsWith(".cdn-telegram.org")
    || host === "telesco.pe" || host.endsWith(".telesco.pe");
}

function allowedAvatarContentType(value: string) {
  return /^image\/(?:jpeg|png|webp)(?:\s*;|$)/i.test(value.trim());
}

async function fetchTrustedAvatar(initial: URL) {
  let current = initial;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (current.protocol !== "https:" || !trustedAvatarHost(current.hostname)) return null;
    const response = await fetch(current, { redirect: "manual", cache: "force-cache", signal: AbortSignal.timeout(5_000), headers: { "user-agent": "MXM/1.0" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location || redirectCount >= MAX_REDIRECTS) return null;
      try { current = new URL(location, current); } catch { return null; }
      continue;
    }
    return response;
  }
  return null;
}

async function GETHandler(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw || raw.length > 2_500) return fallback();
  let target: URL;
  try { target = new URL(raw); } catch { return fallback(); }
  if (target.protocol !== "https:" || target.hostname !== "t.me" || !target.pathname.startsWith("/i/userpic/")) return fallback();

  try {
    const response = await fetchTrustedAvatar(target);
    if (!response) return fallback();
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !allowedAvatarContentType(type)) { await response.body?.cancel().catch(() => undefined); return fallback(); }
    const bytes = await readResponseBytesLimited(response, 2_000_000);
    if (!bytes) return fallback();
    return new NextResponse(toBodyArrayBuffer(bytes), { status: 200, headers: { "content-type": type, "cache-control": "public, max-age=900, s-maxage=3600, stale-while-revalidate=86400", "x-content-type-options": "nosniff" } });
  } catch { return fallback(); }
}

export const GET = withApiErrors("app/api/telegram/avatar/route.ts:GET", GETHandler);
