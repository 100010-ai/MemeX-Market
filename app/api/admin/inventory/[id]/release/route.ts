import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

export const runtime = "nodejs";

// Publishes one system-owned catalog item to the public market at an explicit
// admin-set price, via the same list_virtual_gift RPC every player listing
// goes through. The price is always a deliberate human decision.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "admin-gift-release", String(admin.id), 30, 60))) return NextResponse.json({ error: "Слишком много операций с лотами." }, { status: 429 });
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const price = Number(body?.price);
  if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ error: "Укажите цену лота больше нуля" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: gift, error: giftError } = await supabase.from("virtual_gifts").select("owner_profile_id,status").eq("id", id).single();
  if (giftError || !gift) return NextResponse.json({ error: "Подарок не найден" }, { status: 404 });

  const { data: owner, error: ownerError } = await supabase.from("profiles").select("is_system").eq("id", gift.owner_profile_id).single();
  if (ownerError || !owner) return NextResponse.json({ error: "Профиль владельца не найден" }, { status: 404 });
  if (!owner.is_system) return NextResponse.json({ error: "Этот подарок не относится к системному каталогу" }, { status: 400 });

  const { data, error } = await supabase.rpc("list_virtual_gift", {
    p_profile_id: gift.owner_profile_id,
    p_virtual_gift_id: id,
    p_price: price,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ listing: data });
}
