import { NextResponse } from "next/server";
import { globalResaleCatalogConfigured } from "@/lib/telegram-resale";

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
    version: "0.8.0",
    currency: "virtual TON",
    globalResaleCatalogConfigured: globalResaleCatalogConfigured(),
    realtimeConfigured: Boolean(realtimeUrl && realtimeKey),
  });
}
