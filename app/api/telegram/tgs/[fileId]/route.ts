import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getTelegramTgsJson, isKnownGiftFile } from "@/lib/gifts";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  if (!(await requireProfile())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { fileId } = await params;
    if (!(await isKnownGiftFile(fileId))) return NextResponse.json({ error: "Unknown gift file" }, { status: 404 });
    return NextResponse.json(await getTelegramTgsJson(fileId), { headers: { "cache-control": "private, max-age=86400" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Animation unavailable" }, { status: 404 });
  }
}
