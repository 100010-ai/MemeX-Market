import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const symbol = String(body.symbol || "").trim().toUpperCase();
    const description = String(body.description || "").trim();

    if (name.length < 2 || name.length > 32) return NextResponse.json({ error: "Name must be 2–32 characters" }, { status: 400 });
    if (!/^[A-Z0-9]{2,8}$/.test(symbol)) return NextResponse.json({ error: "Ticker must be 2–8 letters/numbers" }, { status: 400 });
    if (description.length > 180) return NextResponse.json({ error: "Description is too long" }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("create_coin", {
      p_profile_id: profile.id,
      p_name: name,
      p_symbol: symbol,
      p_description: description,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ coin: data });
  } catch {
    return NextResponse.json({ error: "Could not create coin" }, { status: 500 });
  }
}
