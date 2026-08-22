import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { getSessionProfileSnapshot } from "@/lib/auth";
import { getSessionConfigStatus } from "@/lib/session";

async function GETHandler() {
  if (!getSessionConfigStatus().configured) return NextResponse.json({ error: "Сессии временно недоступны" }, { status: 503 });
  try {
    const profile = await getSessionProfileSnapshot();
    if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ profile }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("me", error);
    return NextResponse.json({ error: "Could not load profile" }, { status: 500 });
  }
}
export const GET = withApiErrors("app/api/me/route.ts:GET", GETHandler);
