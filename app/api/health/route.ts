import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, app: "MemeX Market", short: "MXM", version: "0.3.0" });
}
