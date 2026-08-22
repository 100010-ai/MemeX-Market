import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-route";
import { clearSession } from "@/lib/session";
import { sameOriginMutation } from "@/lib/security";

async function POSTHandler(request: Request) {
  if (!sameOriginMutation(request)) {
    return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  }
  await clearSession();
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

export const POST = withApiErrors("app/api/auth/logout/route.ts:POST", POSTHandler);
