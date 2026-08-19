import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 20;

function trustedMediaHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "tonapi.io"
    || host.endsWith(".tonapi.io")
    || host === "fragment.com"
    || host.endsWith(".fragment.com")
    || host === "telegram.org"
    || host.endsWith(".telegram.org")
    || host === "t.me"
    || host.endsWith(".t.me")
    || host.endsWith(".cdn-telegram.org")
    || host === "telesco.pe"
    || host.endsWith(".telesco.pe")
    || host === "ipfs.io";
}

function telegramCollectibleSlug(telegramName: unknown, baseName: unknown, giftNumber: unknown) {
  const stored = String(telegramName || "").trim();
  if (/^[A-Za-z0-9_-]{3,160}-\d{1,12}$/.test(stored)) return stored;

  const base = String(baseName || "").replace(/[^A-Za-z0-9]/g, "");
  const number = Number(giftNumber);
  if (!base || !Number.isSafeInteger(number) || number <= 0) return null;
  return `${base}-${number}`;
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
}

function tgsFromTelegramHtml(html: string) {
  const tags = html.match(/<source\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/\btype\s*=\s*["']application\/x-tgsticker["']/i.test(tag)) continue;
    const source = tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i)?.[1]
      || tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (source) return decodeHtmlAttribute(source.trim().split(/\s+/)[0]);
  }
  return null;
}

async function officialTelegramTgs(slug: string, signal: AbortSignal) {
  const response = await fetch(`https://t.me/nft/${encodeURIComponent(slug)}`, {
    signal,
    cache: "force-cache",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 MXM-Market/0.14",
    },
  });
  if (!response.ok) return null;
  const source = tgsFromTelegramHtml(await response.text());
  if (!source) return null;

  try {
    const url = new URL(source, "https://t.me");
    if (url.protocol !== "https:" || !trustedMediaHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function storedTonApiAnimation(source: unknown) {
  const raw = String(source || "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !trustedMediaHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { assetId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) {
    return NextResponse.json({ error: "Invalid Gift asset" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("gift_assets")
    .select("model_media_url,model_is_animated,catalog_source,is_burned,telegram_name,base_name,gift_number")
    .eq("id", assetId)
    .maybeSingle();
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  if (!result.data || result.data.is_burned || result.data.catalog_source !== "tonapi") {
    return NextResponse.json({ error: "Animated Gift media not found" }, { status: 404 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    // Telegram's public collectible page exposes the official full TGS for the
    // exact numbered Gift. Prefer it over a static TON NFT preview. This keeps
    // the animation tied to the real Telegram collectible rather than guessing
    // by model name or rendering a synthetic animation.
    const slug = telegramCollectibleSlug(result.data.telegram_name, result.data.base_name, result.data.gift_number);
    let url = slug ? await officialTelegramTgs(slug, controller.signal) : null;

    // Some TonAPI metadata already exposes a direct Lottie/TGS URL. Keep that
    // as a second real-media source if the public Telegram page is unavailable.
    if (!url && result.data.model_is_animated === true) {
      url = await storedTonApiAnimation(result.data.model_media_url);
    }
    if (!url) return NextResponse.json({ error: "Animated Gift media not found" }, { status: 404 });

    const upstream = await fetch(url, {
      signal: controller.signal,
      cache: "force-cache",
      headers: {
        accept: "application/x-tgsticker,application/json,application/gzip,application/octet-stream;q=0.9,*/*;q=0.8",
        "user-agent": "MXM-Market/0.14",
      },
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: `Media upstream ${upstream.status}` }, { status: 502 });
    }

    // TGS is gzipped Lottie JSON. Decompress and validate it server-side so
    // older Telegram WebViews do not need CompressionStream support at all.
    const compressed = Buffer.from(await upstream.arrayBuffer());
    if (!compressed.length || compressed.length > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "Animation payload is invalid" }, { status: 502 });
    }
    const isGzip = compressed.length >= 2 && compressed[0] === 0x1f && compressed[1] === 0x8b;
    const jsonBytes = isGzip ? gunzipSync(compressed) : compressed;
    if (jsonBytes.length > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "Animation payload is too large" }, { status: 502 });
    }
    const animation = JSON.parse(jsonBytes.toString("utf8")) as unknown;
    if (!animation || typeof animation !== "object") {
      return NextResponse.json({ error: "Animation payload is invalid" }, { status: 502 });
    }

    return NextResponse.json(animation, {
      headers: {
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Media timeout" : "Media fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
