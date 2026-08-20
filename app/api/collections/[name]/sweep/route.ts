import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit, sameOriginMutation } from "@/lib/security";

const allowedCounts = new Set([2, 5, 10]);

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!sameOriginMutation(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!(await enforceRateLimit(request, "collection-sweep", String(profile.id), 12, 60))) return NextResponse.json({ error: "Слишком много операций. Подождите немного." }, { status: 429 });

  const { name } = await params;
  const baseName = decodeURIComponent(name).trim();
  const body = await request.json().catch(() => ({}));
  const count = Number(body.count);
  if (!baseName) return NextResponse.json({ error: "Коллекция не указана" }, { status: 400 });
  if (!Number.isInteger(count) || !allowedCounts.has(count)) return NextResponse.json({ error: "Можно купить 2, 5 или 10 самых дешёвых Gifts" }, { status: 400 });

  const requestKey = request.headers.get("x-idempotency-key")?.trim() || `sweep-${crypto.randomUUID()}`;
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(requestKey)) return NextResponse.json({ error: "Некорректный ключ операции" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const candidates = await supabase
    .from("gift_market_overview")
    .select("virtual_gift_id,listing_price,owner_profile_id")
    .eq("base_name", baseName)
    .eq("is_burned", false)
    .eq("status", "listed")
    .not("listing_price", "is", null)
    .neq("owner_profile_id", profile.id)
    .or(`listing_expires_at.is.null,listing_expires_at.gt.${nowIso}`)
    .order("listing_price", { ascending: true })
    .order("virtual_gift_id", { ascending: true })
    .limit(count);

  if (candidates.error) return NextResponse.json({ error: candidates.error.message }, { status: 500 });
  const rows = candidates.data || [];
  if (rows.length < count) return NextResponse.json({ error: `В коллекции сейчас доступно только ${rows.length} подходящих лотов` }, { status: 409 });

  const ids = rows.map((row) => String(row.virtual_gift_id));
  const quotedTotal = rows.reduce((sum, row) => sum + Number(row.listing_price || 0), 0);
  const purchase = await supabase.rpc("buy_virtual_gift_cart_v2", {
    p_buyer_id: profile.id,
    p_virtual_gift_ids: ids,
    p_request_key: requestKey,
  });
  if (purchase.error) return NextResponse.json({ error: purchase.error.message }, { status: 409 });

  return NextResponse.json({
    sweep: purchase.data,
    selectedIds: ids,
    quotedTotal,
  }, { headers: { "cache-control": "no-store" } });
}
