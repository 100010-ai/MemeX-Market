import { NextResponse } from "next/server";
import { requireProfile, getProfileSnapshot } from "@/lib/auth";

export async function GET() {
  try {
    const profile = await requireProfile();
    if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ profile: await getProfileSnapshot(profile) });
  } catch (error) {
    console.error("me", error);
    return NextResponse.json({ error: "Could not load profile" }, { status: 500 });
  }
}
