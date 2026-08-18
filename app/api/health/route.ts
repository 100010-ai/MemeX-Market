import { NextResponse } from "next/server";

export async function GET() {
  const realtimeUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const realtimeKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  return NextResponse.json({
    ok: true,
    app: "MemeX Market",
    short: "MXM",
    version: "0.6.1",
    realtimeConfigured: Boolean(realtimeUrl && realtimeKey),
  });
}
