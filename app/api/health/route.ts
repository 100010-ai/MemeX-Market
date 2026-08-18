import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, app: "MemeX", version: "0.2.0" });
}
