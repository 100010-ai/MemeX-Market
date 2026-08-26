import { apiFailure, withApiErrors } from "@/lib/api-route";
import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { fragmentGiftMedia, telegramCollectibleSlug } from "@/lib/fragment-gifts";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";
import { readResponseBytesLimited, toBodyArrayBuffer } from "@/lib/http-body";
import { tonApiGet } from "@/lib/providers/tonapi-client";

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
  chain_nft_address: string | null;
  chain_metadata: unknown;
};

type TonApiPreview = { resolution?: string; url?: string };
type TonApiNftItem = {
  previews?: TonApiPreview[];
  trust?: string;
  verified?: boolean;
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
    || host === "getgems.io"
    || host.endsWith(".getgems.io")
    || host === "headgun.org"
    || host === "chat-mafia.com"
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

function previewScore(resolution: unknown) {
  const match = String(resolution || "").match(/(\d+)x(\d+)/i);
  return match ? Number(match[1]) * Number(match[2]) : 0;
}

function metadataUrl(metadata: unknown, keys: string[]) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  for (const key of keys) {
    const candidate = trustedUrl(record[key]);
    if (candidate) return candidate;
  }
  return null;
}

async function liveTonApiPreviewUrls(chainAddress: string | null) {
  const address = String(chainAddress || "").trim();
  if (!address) return [] as URL[];
  try {
    const item = await tonApiGet<TonApiNftItem>(`/v2/nfts/${encodeURIComponent(address)}`, {
      timeoutMs: 4_000,
      attempts: 1,
      cacheTtlMs: 60_000,
      allowStaleOnFailure: true,
    });
    if (item.verified === false || String(item.trust || "").toLowerCase() === "blacklist") return [];
    return [...(item.previews || [])]
      .sort((a, b) => previewScore(b.resolution) - previewScore(a.resolution))
      .map((preview) => trustedUrl(preview.url))
      .filter((url): url is URL => Boolean(url));
  } catch (error) {
    console.warn("gift media TonAPI preview fallback skipped", { chainAddress: address, error });
    return [];
  }
}

async function fetchCandidate(
  url: URL,
  requestSignal: AbortSignal,
  accept: string,
  timeoutMs: number,
  maxBytes: number,
  acceptsContentType?: (contentType: string) => boolean,
) {
  if (requestSignal.aborted) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, timeoutMs);
  requestSignal.addEventListener("abort", abort, { once: true });

  try {
    let current = url;
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 2; redirects += 1) {
      response = await fetch(current, {
        signal: controller.signal,
        cache: "force-cache",
        redirect: "manual",
        headers: {
          accept,
          "user-agent": "MXM-Market/0.72.2",
          referer: "https://fragment.com/",
        },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      const next = location ? trustedUrl(new URL(location, current).href) : null;
      if (!next || redirects === 2) return null;
      current = next;
      response = null;
    }
    if (!response) return null;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (acceptsContentType && !acceptsContentType(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const bytes = await readResponseBytesLimited(response, maxBytes);
    return bytes ? { bytes, contentType } : null;
  } catch {
    // A single unavailable CDN must not prevent the next trusted source from
    // being attempted. Exhaustion is logged once by the route handler.
    return null;
  } finally {
    clearTimeout(timeout);
    requestSignal.removeEventListener("abort", abort);
  }
}

async function previewResponse(candidates: Array<URL | null>, signal: AbortSignal) {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate.href)) continue;
    seen.add(candidate.href);
    const upstream = await fetchCandidate(
      candidate,
      signal,
      "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.9,*/*;q=0.5",
      1_800,
      MAX_PREVIEW_BYTES,
      (contentType) => contentType.startsWith("image/"),
    );
    if (!upstream) continue;
    return new Response(toBodyArrayBuffer(upstream.bytes), {
      status: 200,
      headers: {
        "content-type": upstream.contentType.split(";")[0] || "image/jpeg",
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        "x-content-type-options": "nosniff",
        "x-mxm-media-source": candidate.hostname,
      },
    });
  }
  return null;
}

async function animationResponse(candidates: Array<URL | null>, signal: AbortSignal) {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate.href)) continue;
    seen.add(candidate.href);
    const upstream = await fetchCandidate(
      candidate,
      signal,
      "application/json,application/x-tgsticker,application/gzip,application/octet-stream;q=0.9,*/*;q=0.5",
      2_500,
      MAX_ANIMATION_SOURCE_BYTES,
    );
    if (!upstream) continue;
    const compressed = Buffer.from(upstream.bytes);

    try {
      const isGzip = compressed.length >= 2 && compressed[0] === 0x1f && compressed[1] === 0x8b;
      const jsonBytes = isGzip
        ? gunzipSync(compressed, { maxOutputLength: MAX_ANIMATION_BYTES })
        : compressed;
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

async function GETHandler(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { assetId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) {
    return NextResponse.json({ error: "Некорректный идентификатор подарка" }, { status: 400 });
  }

  const requestUrl = new URL(request.url);
  const suppliedSlug = requestUrl.searchParams.get("slug")?.trim() || "";
  const suppliedFragment = suppliedSlug ? fragmentGiftMedia(suppliedSlug) : null;
  const variant = requestUrl.searchParams.get("variant") === "preview" ? "preview" : "animation";
  const size = requestUrl.searchParams.get("size") === "medium" ? "medium" : "large";

  try {
    const supabase = getSupabaseAdmin();
    const primary = await supabase
      .from("gift_assets")
      .select("model_media_url,model_preview_url,model_is_animated,catalog_source,is_burned,telegram_name,base_name,gift_number,chain_nft_address,chain_metadata")
      .eq("id", assetId)
      .maybeSingle();

    const queryError = primary.error;
    const row = primary.data as unknown as GiftMediaRow | null;

    if (queryError) return apiFailure(queryError, "Не удалось получить медиа подарка");
    if (!row || row.is_burned || row.catalog_source !== "tonapi") {
      return NextResponse.json({ error: "Медиа подарка не найдено" }, { status: 404 });
    }

    const slug = telegramCollectibleSlug(row.telegram_name, row.base_name, row.gift_number);
    const fragment = slug ? fragmentGiftMedia(slug) : null;
    const alternateFragment = suppliedSlug && suppliedSlug.toLowerCase() !== slug?.toLowerCase()
      ? suppliedFragment
      : null;
    const metadataPreview = metadataUrl(row.chain_metadata, ["image", "image_url", "preview", "thumbnail", "thumbnail_url"]);
    const metadataAnimation = metadataUrl(row.chain_metadata, ["animation_url", "animation", "video_url", "video", "content_url"]);

    if (variant === "preview") {
      const storedCandidates = size === "medium" ? [
        trustedUrl(row.model_preview_url),
        metadataPreview,
        trustedUrl(fragment?.medium),
        trustedUrl(fragment?.small),
        trustedUrl(fragment?.large),
        trustedUrl(alternateFragment?.medium),
        trustedUrl(alternateFragment?.large),
        row.model_is_animated ? null : trustedUrl(row.model_media_url),
      ] : [
        trustedUrl(row.model_preview_url),
        metadataPreview,
        trustedUrl(fragment?.large),
        trustedUrl(fragment?.medium),
        trustedUrl(alternateFragment?.large),
        trustedUrl(alternateFragment?.medium),
        row.model_is_animated ? null : trustedUrl(row.model_media_url),
      ];
      const storedResponse = await previewResponse(storedCandidates, request.signal);
      if (storedResponse) return storedResponse;

      // Older catalogue rows may already contain an optimistic Fragment URL in
      // model_preview_url. Recover from that stale data by asking TonAPI for
      // the current verified NFT previews using the immutable chain address.
      const liveTonApiCandidates = await liveTonApiPreviewUrls(row.chain_nft_address);
      const liveResponse = await previewResponse(liveTonApiCandidates.slice(0, 3), request.signal);
      if (liveResponse) return liveResponse;
      console.warn("gift media sources exhausted", { assetId, variant, size, hasChainAddress: Boolean(row.chain_nft_address) });
      return NextResponse.json({ error: "Превью подарка не найдено" }, { status: 404 });
    }

    const animation = await animationResponse([
      row.model_is_animated ? trustedUrl(row.model_media_url) : null,
      row.model_is_animated ? metadataAnimation : null,
      trustedUrl(fragment?.animation),
      trustedUrl(alternateFragment?.animation),
    ], request.signal);
    if (animation) return animation;
    console.warn("gift media sources exhausted", { assetId, variant, size, hasChainAddress: Boolean(row.chain_nft_address) });
    return NextResponse.json({ error: "Анимация подарка не найдена" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Media timeout" : "Media fetch failed";
    console.warn("gift media proxy", { assetId, variant, error });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
export const GET = withApiErrors("app/api/gifts/media/[assetId]/route.ts:GET", GETHandler);
