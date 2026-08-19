import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { fragmentGiftMedia, telegramCollectibleSlug } from "@/lib/fragment-gifts";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_ANIMATION_BYTES = 8 * 1024 * 1024;
const MAX_ANIMATION_SOURCE_BYTES = 6 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 6 * 1024 * 1024;

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

function trustedUrl(source: unknown) {
  const raw = String(source || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !trustedMediaHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function fetchCandidate(url: URL, signal: AbortSignal, accept: string) {
  const response = await fetch(url, {
    signal,
    cache: "force-cache",
    headers: {
      accept,
      "user-agent": "MXM-Market/0.15",
      referer: "https://fragment.com/",
    },
  });
  return response.ok ? response : null;
}

async function previewResponse(candidates: Array<URL | null>, signal: AbortSignal) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const upstream = await fetchCandidate(candidate, signal, "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.9,*/*;q=0.5");
    if (!upstream) continue;
    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) continue;
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_PREVIEW_BYTES) continue;
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": contentType.split(";")[0] || "image/jpeg",
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        "x-content-type-options": "nosniff",
      },
    });
  }
  return null;
}

async function animationResponse(candidates: Array<URL | null>, signal: AbortSignal) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const upstream = await fetchCandidate(candidate, signal, "application/json,application/x-tgsticker,application/gzip,application/octet-stream;q=0.9,*/*;q=0.5");
    if (!upstream) continue;
    const compressed = Buffer.from(await upstream.arrayBuffer());
    if (!compressed.length || compressed.length > MAX_ANIMATION_SOURCE_BYTES) continue;

    try {
      const isGzip = compressed.length >= 2 && compressed[0] === 0x1f && compressed[1] === 0x8b;
      const jsonBytes = isGzip ? gunzipSync(compressed) : compressed;
      if (!jsonBytes.length || jsonBytes.length > MAX_ANIMATION_BYTES) continue;
      const animation = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
      if (!animation || typeof animation !== "object" || !Array.isArray(animation.layers)) continue;
      return NextResponse.json(animation, {
        headers: {
          "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      // Try the next official source rather than returning a broken Lottie.
    }
  }
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const profile = await requireProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { assetId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) {
    return NextResponse.json({ error: "Invalid Gift asset" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  let result = await supabase
    .from("gift_assets")
    .select("model_media_url,model_preview_url,model_is_animated,catalog_source,is_burned,telegram_name,base_name,gift_number")
    .eq("id", assetId)
    .maybeSingle();

  // Backward-compatible read for deployments that have not applied the v0.14
  // model_preview_url column yet. Fragment media can be derived from the Gift
  // slug, so the preview/animation endpoint does not actually need that column.
  if (result.error && (result.error.code === "42703" || /model_preview_url/i.test(result.error.message || ""))) {
    const legacy = await supabase
      .from("gift_assets")
      .select("model_media_url,model_is_animated,catalog_source,is_burned,telegram_name,base_name,gift_number")
      .eq("id", assetId)
      .maybeSingle();
    result = legacy.error
      ? { data: null, error: legacy.error } as typeof result
      : { data: legacy.data ? { ...legacy.data, model_preview_url: null } : null, error: null } as typeof result;
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  if (!result.data || result.data.is_burned || result.data.catalog_source !== "tonapi") {
    return NextResponse.json({ error: "Gift media not found" }, { status: 404 });
  }

  const slug = telegramCollectibleSlug(result.data.telegram_name, result.data.base_name, result.data.gift_number);
  const fragment = slug ? fragmentGiftMedia(slug) : null;
  const variant = new URL(request.url).searchParams.get("variant") === "preview" ? "preview" : "animation";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    if (variant === "preview") {
      // Fragment's JPG is the complete collectible render, including the exact
      // Telegram backdrop and symbol pattern. TonAPI's preview can be only the
      // transparent model, which is what caused the black cards in v0.14.
      const response = await previewResponse([
        trustedUrl(fragment?.large),
        trustedUrl(fragment?.medium),
        trustedUrl(result.data.model_preview_url),
        result.data.model_is_animated ? null : trustedUrl(result.data.model_media_url),
      ], controller.signal);
      return response || NextResponse.json({ error: "Gift preview not found" }, { status: 404 });
    }

    // Prefer Fragment's full collectible Lottie. Unlike the TGS extracted from
    // t.me/nft, it is the composed NFT presentation rather than only the model
    // sticker layer, so the backdrop does not disappear when animation starts.
    const response = await animationResponse([
      trustedUrl(fragment?.animation),
      result.data.model_is_animated ? trustedUrl(result.data.model_media_url) : null,
    ], controller.signal);
    return response || NextResponse.json({ error: "Animated Gift media not found" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Media timeout" : "Media fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
