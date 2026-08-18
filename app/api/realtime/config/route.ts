import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!url) {
    return NextResponse.json({ enabled: false, reason: "Не задан URL Supabase для Realtime." });
  }
  if (!key) {
    return NextResponse.json({
      enabled: false,
      reason: "Не задан publishable/anon key Supabase. Основной API продолжает работать, Realtime не запускается.",
    });
  }

  return NextResponse.json({ enabled: true, url, key }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
