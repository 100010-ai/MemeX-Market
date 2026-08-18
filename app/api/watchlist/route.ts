import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_watchlist")
    .select("kind,coin_id,gift_collection")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    watchlist: {
      coinIds: (data || []).filter((row) => row.kind === "coin" && row.coin_id).map((row) => String(row.coin_id)),
      giftCollections: (data || []).filter((row) => row.kind === "gift_collection" && row.gift_collection).map((row) => String(row.gift_collection)),
    },
  });
}

export async function POST(request: Request) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const kind = body.kind === "coin" ? "coin" : body.kind === "gift_collection" ? "gift_collection" : null;
  const enabled = body.enabled === true;
  if (!kind) return NextResponse.json({ error: "Invalid watchlist kind" }, { status: 400 });
  const supabase = getSupabaseAdmin();

  if (kind === "coin") {
    const coinId = typeof body.coinId === "string" ? body.coinId : "";
    if (!coinId) return NextResponse.json({ error: "Coin is required" }, { status: 400 });
    const { data: coin, error: coinError } = await supabase.from("coins").select("id").eq("id", coinId).eq("status", "active").maybeSingle();
    if (coinError) return NextResponse.json({ error: coinError.message }, { status: 500 });
    if (!coin) return NextResponse.json({ error: "Coin not found" }, { status: 404 });
    if (enabled) {
      const { data: existing, error: existingError } = await supabase.from("user_watchlist").select("id").eq("profile_id", profile.id).eq("kind", "coin").eq("coin_id", coinId).maybeSingle();
      if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
      if (!existing) {
        const { error } = await supabase.from("user_watchlist").insert({ profile_id: profile.id, kind: "coin", coin_id: coinId, gift_collection: null });
        if (error && error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await supabase.from("user_watchlist").delete().eq("profile_id", profile.id).eq("kind", "coin").eq("coin_id", coinId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ enabled });
  }

  const baseName = typeof body.baseName === "string" ? body.baseName.trim() : "";
  if (!baseName) return NextResponse.json({ error: "Gift collection is required" }, { status: 400 });
  const { data: collection, error: collectionError } = await supabase.from("gift_collection_overview").select("base_name").eq("base_name", baseName).maybeSingle();
  if (collectionError) return NextResponse.json({ error: collectionError.message }, { status: 500 });
  if (!collection) return NextResponse.json({ error: "Gift collection not found" }, { status: 404 });
  if (enabled) {
    const { data: existing, error: existingError } = await supabase.from("user_watchlist").select("id").eq("profile_id", profile.id).eq("kind", "gift_collection").eq("gift_collection", baseName).maybeSingle();
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
    if (!existing) {
      const { error } = await supabase.from("user_watchlist").insert({ profile_id: profile.id, kind: "gift_collection", coin_id: null, gift_collection: baseName });
      if (error && error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await supabase.from("user_watchlist").delete().eq("profile_id", profile.id).eq("kind", "gift_collection").eq("gift_collection", baseName);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ enabled });
}
