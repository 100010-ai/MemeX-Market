import { withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";

async function GETHandler() {
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
    version: "0.56.0",
    currency: "virtual TON",
    catalogMode: "Bot API + validated TON NFT catalog via TonAPI + finite Genesis + secondary virtual TON trading",
    realtimeConfigured: Boolean(realtimeUrl && realtimeKey),
  });
}
export const GET = withApiErrors("app/api/health/route.ts:GET", GETHandler);
