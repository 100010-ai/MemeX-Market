import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api-route";
import { requireAdminProfile } from "@/lib/admin";

export const runtime = "nodejs";

async function GETHandler() {
  const admin = await requireAdminProfile();
  if (!admin) {
    return NextResponse.json(
      { allowed: false, error: "Ops доступен только разрешённым администраторам Telegram" },
      { status: 403, headers: { "cache-control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    { allowed: true },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export const GET = withApiErrors("app/api/admin/access/route.ts:GET", GETHandler);
