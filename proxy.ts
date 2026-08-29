import { NextRequest, NextResponse } from "next/server";
import { getCanonicalHost, getCanonicalOrigin } from "@/lib/canonical-origin";

const VERCEL_SUFFIX = ".vercel.app";

function withPreviewPrivacy(response: NextResponse) {
  if (process.env.VERCEL_ENV === "preview") {
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  }
  return response;
}

export function proxy(request: NextRequest) {
  const canonicalOrigin = getCanonicalOrigin();
  const canonicalHost = getCanonicalHost();
  const requestHost = String(request.headers.get("host") || "").toLowerCase();

  if (
    process.env.VERCEL_ENV === "production" &&
    canonicalOrigin &&
    canonicalHost &&
    requestHost &&
    requestHost !== canonicalHost &&
    requestHost.endsWith(VERCEL_SUFFIX)
  ) {
    const destination = new URL(request.nextUrl.pathname + request.nextUrl.search, canonicalOrigin);
    return NextResponse.redirect(destination, 308);
  }

  return withPreviewPrivacy(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
