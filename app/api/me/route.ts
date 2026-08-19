import { NextResponse } from "next/server";
import { getSessionProfileSnapshot } from "@/lib/auth";

export async function GET() {
  try {
    const profile = await getSessionProfileSnapshot();
    if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ profile }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("me", error);
    return NextResponse.json({ error: "Could not load profile" }, { status: 500 });
  }
}
