import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveGiftImageUrl } from "@/lib/mappers";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";

type RawPreview = {
  virtualGiftId?: unknown;
  giftNumber?: unknown;
  modelPreviewUrl?: unknown;
  modelMediaUrl?: unknown;
  symbolMediaUrl?: unknown;
  listingPrice?: unknown;
  modelName?: unknown;
  backdropName?: unknown;
  symbolName?: unknown;
};

type RawCollection = {
  baseName?: unknown;
  listedCount?: unknown;
  floorPrice?: unknown;
  previews?: unknown;
};

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function GETHandler(request: NextRequest) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const runtimeConfig = await getRuntimeConfig();
  if (!runtimeConfig.featureFlags.gifts) {
    return NextResponse.json({ error: "Торговля подарками временно отключена" }, { status: 503 });
  }
  const requested = Number(request.nextUrl.searchParams.get("limit") || 30);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(60, Math.trunc(requested))) : 30;
  const supabase = getSupabaseAdmin();

  try {
    const result = await supabase.rpc("gift_market_collection_cards_v210", { p_limit: limit });
    if (result.error) throw result.error;
    const rows = Array.isArray(result.data) ? result.data as RawCollection[] : [];
    const collections = rows.flatMap((row) => {
      const baseName = typeof row.baseName === "string" ? row.baseName.trim() : "";
      if (!baseName) return [];
      const previews = (Array.isArray(row.previews) ? row.previews : []).flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const preview = raw as RawPreview;
        const virtualGiftId = typeof preview.virtualGiftId === "string" ? preview.virtualGiftId : "";
        const giftNumber = finite(preview.giftNumber);
        const listingPrice = finite(preview.listingPrice);
        if (!virtualGiftId || giftNumber == null || listingPrice == null || listingPrice <= 0) return [];
        const imageUrl = resolveGiftImageUrl({
          model_preview_url: preview.modelPreviewUrl,
          model_media_url: preview.modelMediaUrl,
          symbol_media_url: preview.symbolMediaUrl,
        });
        return [{
          virtualGiftId,
          giftNumber,
          listingPrice,
          imageUrl,
          modelName: typeof preview.modelName === "string" ? preview.modelName : "",
          backdropName: typeof preview.backdropName === "string" ? preview.backdropName : "",
          symbolName: typeof preview.symbolName === "string" ? preview.symbolName : "",
        }];
      });
      return [{
        baseName,
        listedCount: Math.max(0, finite(row.listedCount) || 0),
        floorPrice: finite(row.floorPrice),
        previewTotal: previews.reduce((sum, preview) => sum + preview.listingPrice, 0),
        previews,
      }];
    });
    return NextResponse.json({ collections }, { headers: { "cache-control": "private, max-age=0, must-revalidate" } });
  } catch (error) {
    console.error("market collection cards", error);
    return apiFailure(error, "Не удалось загрузить коллекции рынка");
  }
}

export const GET = withApiErrors("app/api/market/collections/route.ts:GET", GETHandler);
