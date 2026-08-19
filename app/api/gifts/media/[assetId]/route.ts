import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { fragmentGiftMedia, telegramCollectibleSlug } from "@/lib/fragment-gifts";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { readSession } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_ANIMATION_BYTES = 8 * 1024 * 1024;
const MAX_ANIMATION_SOURCE_BYTES = 6 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 6 * 1024 * 1024;

type GiftMediaRow = {
  model_media_url: string | null;
  model_preview_url: string | null;
  model_is_animated: boolean | null;
  catalog_source: string | null;
  is_burned: boolean | null;
  telegram_name: string | null;
  base_name: string | null;
  gift_number: number | string | null;
};

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
      "user-agent": "MXM-Market/0.17",
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
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { assetId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) {
    return NextResponse.json({ error: "Invalid Gift asset" }, { status: 400 });
  }

  const requestUrl = new URL(request.url);
  const suppliedSlug = requestUrl.searchParams.get("slug")?.trim() || "";
  const suppliedFragment = suppliedSlug ? fragmentGiftMedia(suppliedSlug) : null;
  const variant = requestUrl.searchParams.get("variant") === "preview" ? "preview" : "animation";
  const size = requestUrl.searchParams.get("size") === "medium" ? "medium" : "large";

  // Current clients already know the normalized Telegram collectible slug.
  // Using it avoids two server round-trips (profile + asset lookup) for every
  // visible animated card while still restricting the proxy to Fragment URLs.
  if (suppliedFragment) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      if (variant === "preview") {
        const candidates = size === "medium"
          ? [trustedUrl(suppliedFragment.medium), trustedUrl(suppliedFragment.small), trustedUrl(suppliedFragment.large)]
          : [trustedUrl(suppliedFragment.large), trustedUrl(suppliedFragment.medium)];
        const response = await previewResponse(candidates, controller.signal);
        return response || NextResponse.json({ error: "Gift preview not found" }, { status: 404 });
      }
      const response = await animationResponse([trustedUrl(suppliedFragment.animation)], controller.signal);
      return response || NextResponse.json({ error: "Animated Gift media not found" }, { status: 404 });
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError" ? "Media timeout" : "Media fetch failed";
      return NextResponse.json({ error: message }, { status: 502 });
    } finally {
      clearTimeout(timeout);
    }
  }

  const supabase = getSupabaseAdmin();
  const primary = await supabase
    .from("gift_assets")
    .select("model_media_url,model_preview_url,model_is_animated,catalog_source,is_burned,telegram_name,base_name,gift_number")
    .eq("id", assetId)
    .maybeSingle();

  let queryError = primary.error;
  let row = primary.data as unknown as GiftMediaRow | null;

  // Backward-compatible read for deployments that have not applied the v0.14
  // model_preview_url column yet. Fragment media can be derived from the Gift
  // slug, so the preview/animation endpoint does not actually need that column.
  if (queryError && (queryError.code === "42703" || /model_preview_url/i.test(queryError.message || ""))) {
    const legacy = await supabase
      .from("gift_assets")
      .select("model_media_url,model_is_animated,catalog_source,is_burned,telegram_name,base_name,gift_number")
      .eq("id", assetId)
      .maybeSingle();
    queryError = legacy.error;
    row = legacy.data
      ? { ...(legacy.data as unknown as Omit<GiftMediaRow, "model_preview_url">), model_preview_url: null }
      : null;
  }

  if (queryError) return NextResponse.json({ error: queryError.message }, { status: 500 });
  if (!row || row.is_burned || row.catalog_source !== "tonapi") {
    return NextResponse.json({ error: "Gift media not found" }, { status: 404 });
  }

  const slug = telegramCollectibleSlug(row.telegram_name, row.base_name, row.gift_number);
  const fragment = slug ? fragmentGiftMedia(slug) : null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    if (variant === "preview") {
      // Fragment's JPG is the complete collectible render, including the exact
      // Telegram backdrop and symbol pattern. TonAPI's preview can be only the
      // transparent model, which is what caused the black cards in v0.14.
      const response = await previewResponse(size === "medium" ? [
        trustedUrl(fragment?.medium),
        trustedUrl(fragment?.small),
        trustedUrl(fragment?.large),
        trustedUrl(row.model_preview_url),
      ] : [
        trustedUrl(fragment?.large),
        trustedUrl(fragment?.medium),
        trustedUrl(row.model_preview_url),
        row.model_is_animated ? null : trustedUrl(row.model_media_url),
      ], controller.signal);
      return response || NextResponse.json({ error: "Gift preview not found" }, { status: 404 });
    }

    // Prefer Fragment's full collectible Lottie. Unlike the TGS extracted from
    // t.me/nft, it is the composed NFT presentation rather than only the model
    // sticker layer, so the backdrop does not disappear when animation starts.
    const response = await animationResponse([
      trustedUrl(fragment?.animation),
      row.model_is_animated ? trustedUrl(row.model_media_url) : null,
    ], controller.signal);
    return response || NextResponse.json({ error: "Animated Gift media not found" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Media timeout" : "Media fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
