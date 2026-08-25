import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-route";
import { clearAdminSession } from "@/lib/admin-session";
import { sameOriginMutation } from "@/lib/security";

async function POSTHandler(request: Request) {
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  await clearAdminSession();
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "private, no-store" } });
}

export const POST = withApiErrors("app/api/admin/logout/route.ts:POST", POSTHandler);
