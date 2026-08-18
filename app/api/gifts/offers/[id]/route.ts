import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  const supabase = getSupabaseAdmin();
  if (action === "cancel") {
    const { error } = await supabase.rpc("cancel_gift_offer", { p_buyer_id: profile.id, p_offer_id: id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ status: "cancelled" });
  }
  if (action === "accept" || action === "reject") {
    const { data, error } = await supabase.rpc("resolve_gift_offer", { p_owner_id: profile.id, p_offer_id: id, p_action: action });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json(data);
  }
  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
