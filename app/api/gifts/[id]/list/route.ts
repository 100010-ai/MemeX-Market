import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const price = body.price === null || body.price === "" || body.price === undefined ? null : Number(body.price);
  if (price !== null && (!Number.isFinite(price) || price <= 0)) return NextResponse.json({ error: "Invalid listing price" }, { status: 400 });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("list_virtual_gift", { p_profile_id: profile.id, p_virtual_gift_id: id, p_price: price });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ listing: data });
}
