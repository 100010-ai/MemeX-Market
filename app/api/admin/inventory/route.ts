import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireAdminProfile } from "@/lib/admin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Lists system-owned, unlisted Gifts that came from a real Telegram catalog
// sync and are waiting on an admin to set a real price and publish them.
async function GETHandler() {
  const admin = await requireAdminProfile();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = getSupabaseAdmin();
  try {
    const systemProfiles = await supabase.from("profiles").select("id").eq("is_system", true).limit(100);
    if (systemProfiles.error) throw systemProfiles.error;
    const systemIds = (systemProfiles.data || []).map((row) => String(row.id));
    if (!systemIds.length) return NextResponse.json({ items: [], checkedAt: new Date().toISOString() });

    const overview = await supabase
      .from("gift_market_overview")
      .select(
        "asset_id,virtual_gift_id,telegram_name,base_name,gift_number,model_name,model_rarity,backdrop_name,backdrop_center_color,backdrop_edge_color,owner_profile_id,estimated_value,status,created_at",
      )
      .in("owner_profile_id", systemIds)
      .eq("status", "owned")
      .eq("is_burned", false)
      .order("created_at", { ascending: false })
      .limit(1_000);
    if (overview.error) throw overview.error;

    const items = (overview.data || []).map((row) => ({
      assetId: String(row.asset_id),
      virtualGiftId: String(row.virtual_gift_id),
      telegramName: String(row.telegram_name),
      baseName: String(row.base_name),
      giftNumber: Number(row.gift_number),
      modelName: String(row.model_name),
      modelRarity: row.model_rarity == null ? null : String(row.model_rarity),
      backdropName: String(row.backdrop_name),
      backdropCenterColor: Number(row.backdrop_center_color),
      backdropEdgeColor: Number(row.backdrop_edge_color),
      estimatedValue: row.estimated_value == null ? null : Number(row.estimated_value),
      createdAt: String(row.created_at),
    }));

    return NextResponse.json({ items, checkedAt: new Date().toISOString() });
  } catch (error) {
    console.error("admin inventory", error);
    return apiFailure(error, "Не удалось загрузить каталог");
  }
}
export const GET = withApiErrors("app/api/admin/inventory/route.ts:GET", GETHandler);
