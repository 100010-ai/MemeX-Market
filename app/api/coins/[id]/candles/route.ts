import { apiFailure, withApiErrors } from "@/lib/api-route";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { validUuidLike } from "@/lib/security";
import { finiteNumber, safeIsoDate } from "@/lib/safe-data";

export const runtime = "nodejs";

type Frame = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
const FRAME_CONFIG: Record<Frame, { seconds: number; limit: number }> = {
  "1m": { seconds: 60, limit: 480 },
  "5m": { seconds: 300, limit: 576 },
  "15m": { seconds: 900, limit: 672 },
  "1h": { seconds: 3600, limit: 720 },
  "4h": { seconds: 14400, limit: 540 },
  "1d": { seconds: 86400, limit: 365 },
};

function parseFrame(request: Request): Frame {
  try {
    const value = new URL(request.url).searchParams.get("frame") as Frame | null;
    return value && value in FRAME_CONFIG ? value : "15m";
  } catch {
    return "15m";
  }
}

async function GETHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { id } = await params;
  if (!validUuidLike(id)) return NextResponse.json({ error: "Некорректный идентификатор мемкоина" }, { status: 400 });

  const frame = parseFrame(request);
  const config = FRAME_CONFIG[frame];
  try {
    const result = await getSupabaseAdmin().rpc("coin_candles_v201", {
      p_coin_id: id,
      p_bucket_seconds: config.seconds,
      p_limit: config.limit,
    });
    if (result.error) throw result.error;
    const rows = Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
    return NextResponse.json({
      frame,
      candles: rows.flatMap((row) => {
        const iso = safeIsoDate(row.bucket_start, "");
        const time = iso ? Math.floor(Date.parse(iso) / 1000) : Number.NaN;
        const open = finiteNumber(row.open, Number.NaN);
        const high = finiteNumber(row.high, Number.NaN);
        const low = finiteNumber(row.low, Number.NaN);
        const close = finiteNumber(row.close, Number.NaN);
        if (![time, open, high, low, close].every(Number.isFinite)) return [];
        return [{ time, open, high, low, close, volume: Math.max(0, finiteNumber(row.volume)) }];
      }),
    }, { headers: { "cache-control": "private, max-age=5, stale-while-revalidate=10" } });
  } catch (error) {
    return apiFailure(error, "Не удалось загрузить историю цены мемкоина");
  }
}

export const GET = withApiErrors("app/api/coins/[id]/candles/route.ts:GET", GETHandler);
