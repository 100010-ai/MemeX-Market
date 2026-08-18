import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { syncTelegramGifts } from "@/lib/gifts";

export const runtime = "nodejs";

export async function POST() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const last = profile.last_gift_sync_at ? new Date(profile.last_gift_sync_at).getTime() : 0;
    if (last && Date.now() - last < 20_000) return NextResponse.json({ error: "Gift sync is limited to once every 20 seconds" }, { status: 429 });
    const result = await syncTelegramGifts(String(profile.id), Number(profile.telegram_id));
    return NextResponse.json(result);
  } catch (error) {
    console.error("gift sync", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sync Telegram Gifts" }, { status: 502 });
  }
}
