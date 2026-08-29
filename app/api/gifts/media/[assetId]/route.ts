import { apiFailure, withApiErrors } from "@/lib/api-route";
import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { fragmentGiftMedia, telegramCollectibleSlug } from "@/lib/fragment-gifts";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";
import { readResponseBytesLimited, toBodyArrayBuffer } from "@/lib/http-body";
import { tonApiGet } from "@/lib/providers/tonapi-client";
import { APP_VERSION } from "@/lib/app-version";

export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_ANIMATION_BYTES = 8 * 1024 * 1024;
const MAX_ANIMATION_SOURCE_BYTES = 6 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 6 * 1024 * 1024;
const MEDIA_CANDIDATE_TIMEOUT_MS = 3_000;
const SLOW_PARTNER_TIMEOUT_MS = 1_100;
const MEDIA_REQUEST_TIMEOUT_MS = 10_000;
const HOST_BREAKER_MS = 60_000;

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
};

type TonApiPreview = { resolution?: string; url?: string };
type TonApiNftItem = {
  previews?: TonApiPreview[];
  trust?: string;
  verified?: boolean;
};

type CandidatePayload = {
  bytes: Uint8Array;
  contentType: string;
};

type HostHealth = { blockedUntil: number; failures: number };
const hostHealth = new Map<string, HostHealth>();

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
    || host === "ipfs.io"
    || host === "headgun.org"
    || host.endsWith(".headgun.org")
    || host === "s.getgems.io"
    || host === "chat-mafia.com";
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

function hostKey(url: URL) {
  return url.hostname.toLowerCase();
}

function hostIsBlocked(url: URL) {
  const key = hostKey(url);
  const health = hostHealth.get(key);
  if (!health) return false;
  if (health.blockedUntil <= Date.now()) {
    hostHealth.delete(key);
    return false;
  }
  return true;
}

function markHostFailure(url: URL) {
  const key = hostKey(url);
  const previous = hostHealth.get(key);
  const failures = Math.min(10, (previous?.failures || 0) + 1);
  const threshold = key === "headgun.org" || key.endsWith(".headgun.org") ? 1 : 2;
  hostHealth.set(key, {
    failures,
    blockedUntil: failures >= threshold ? Date.now() + HOST_BREAKER_MS : 0,
  });
}

function markHostSuccess(url: URL) {
  hostHealth.delete(hostKey(url));
}

function candidateTimeout(url: URL) {
  const host = hostKey(url);
  return host === "headgun.org" || host.endsWith(".headgun.org")
    ? SLOW_PARTNER_TIMEOUT_MS
    : MEDIA_CANDIDATE_TIMEOUT_MS;
}

async function liveTonApiPreviewUrls(chainAddress: string | null) {
  const address = String(chainAddress || "").trim();
  if (!address) return [] as URL[];
  try {
    const item = await tonApiGet<TonApiNftItem>(`/v2/nfts/${encodeURIComponent(address)}`, {
      timeoutMs: 2_500,
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

async function fetchCandidate(url: URL, signal: AbortSignal, accept: string, maxBytes: number): Promise<CandidatePayload | null> {
  if (hostIsBlocked(url)) return null;
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), candidateTimeout(url));

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        accept,
        "user-agent": `MXM-Market/${APP_VERSION}`,
        referer: "https://fragment.com/",
      },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    const bytes = await readResponseBytesLimited(response, maxBytes);
    if (!bytes) return null;
    markHostSuccess(url);
    return {
      bytes,
      contentType: (response.headers.get("content-type") || "").toLowerCase(),
    };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abortFromParent);
  }
}

function mediaCandidateWarning(kind: "preview" | "animation", candidate: URL, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`gift media ${kind} candidate skipped`, { host: candidate.hostname, message });
}

async function previewResponse(candidates: Array<URL | null>, signal: AbortSignal) {
  const seen = new Set<string>();
  const unavailableHosts = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate.href) || unavailableHosts.has(candidate.hostname) || hostIsBlocked(candidate)) continue;
    seen.add(candidate.href);
    try {
      const upstream = await fetchCandidate(
        candidate,
        signal,
        "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.9,*/*;q=0.5",
        MAX_PREVIEW_BYTES,
      );
      if (!upstream) continue;
      if (!upstream.contentType.startsWith("image/")) continue;
      return new Response(toBodyArrayBuffer(upstream.bytes), {
        status: 200,
        headers: {
          "content-type": upstream.contentType.split(";")[0] || "image/jpeg",
          "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
          "x-content-type-options": "nosniff",
          "x-mxm-media-status": "ok",
        },
      });
    } catch (error) {
      if (signal.aborted) throw error;
      unavailableHosts.add(candidate.hostname);
      markHostFailure(candidate);
      mediaCandidateWarning("preview", candidate, error);
    }
  }
  return null;
}

async function animationResponse(candidates: Array<URL | null>, signal: AbortSignal) {
  const seen = new Set<string>();
  const unavailableHosts = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate.href) || unavailableHosts.has(candidate.hostname) || hostIsBlocked(candidate)) continue;
    seen.add(candidate.href);
    try {
      const upstream = await fetchCandidate(
        candidate,
        signal,
        "application/json,application/x-tgsticker,application/gzip,application/octet-stream;q=0.9,*/*;q=0.5",
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
            "x-mxm-media-status": "ok",
          },
        });
      } catch {
        // Try the next official source rather than returning a broken Lottie.
      }
    } catch (error) {
      if (signal.aborted) throw error;
      unavailableHosts.add(candidate.hostname);
      markHostFailure(candidate);
      mediaCandidateWarning("animation", candidate, error);
    }
  }
  return null;
}

function unavailablePreviewResponse() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0b0d0f"/><rect x="154" y="177" width="204" height="158" rx="34" fill="#11161b" stroke="#28313a" stroke-width="4"/><circle cx="215" cy="230" r="22" fill="#394653"/><path d="M171 311l64-65 45 45 31-31 30 51H171z" fill="#27323c"/><text x="256" y="386" text-anchor="middle" fill="#687583" font-family="Arial,sans-serif" font-size="21">MEDIA OFFLINE</text></svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
      "x-content-type-options": "nosniff",
      "x-mxm-media-status": "unavailable",
    },
  });
}

function unavailableAnimationResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "public, max-age=300",
      "x-mxm-media-status": "unavailable",
    },
  });
}

async function GETHandler(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Нужна авторизация Telegram" }, { status: 401 });
  const { assetId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) {
    return NextResponse.json({ error: "Некорректный идентификатор подарка" }, { status: 400 });
  }

  const requestUrl = new URL(request.url);
  const variant = requestUrl.searchParams.get("variant") === "preview" ? "preview" : "animation";
  const size = requestUrl.searchParams.get("size") === "medium" ? "medium" : "large";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_REQUEST_TIMEOUT_MS);

  try {
    const supabase = getSupabaseAdmin();
    const primary = await supabase
      .from("gift_assets")
      .select("model_media_url,model_preview_url,model_is_animated,catalog_source,is_burned,telegram_name,base_name,gift_number,chain_nft_address")
      .eq("id", assetId)
      .maybeSingle();

    const queryError = primary.error;
    const row = primary.data as unknown as GiftMediaRow | null;

    if (queryError) return apiFailure(queryError, "Не удалось получить медиа подарка");
    if (!row || row.is_burned || row.catalog_source !== "tonapi") {
      return variant === "preview" ? unavailablePreviewResponse() : unavailableAnimationResponse();
    }

    const slug = telegramCollectibleSlug(row.telegram_name, row.base_name, row.gift_number);
    const fragment = slug ? fragmentGiftMedia(slug) : null;

    if (variant === "preview") {
      const liveTonApiCandidates = await liveTonApiPreviewUrls(row.chain_nft_address);
      const storedCandidates = size === "medium" ? [
        trustedUrl(row.model_preview_url),
        row.model_is_animated ? null : trustedUrl(row.model_media_url),
        trustedUrl(fragment?.medium),
        trustedUrl(fragment?.small),
        trustedUrl(fragment?.large),
      ] : [
        trustedUrl(row.model_preview_url),
        row.model_is_animated ? null : trustedUrl(row.model_media_url),
        trustedUrl(fragment?.large),
        trustedUrl(fragment?.medium),
      ];
      const response = await previewResponse([...liveTonApiCandidates, ...storedCandidates], controller.signal);
      return response || unavailablePreviewResponse();
    }

    // Static partner NFTs must not manufacture a Lottie request from a
    // Telegram-looking slug. Old clients can still hit this route briefly, so
    // answer quietly while the new client bundle rolls out.
    if (!row.model_is_animated) return unavailableAnimationResponse();

    const animation = await animationResponse([
      trustedUrl(row.model_media_url),
      trustedUrl(fragment?.animation),
    ], controller.signal);
    return animation || unavailableAnimationResponse();
  } catch (error) {
    const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    const message = timedOut ? "Media timeout" : "Media fetch failed";
    console.warn("gift media proxy", { assetId, variant, timedOut, error });
    if (variant === "preview") return unavailablePreviewResponse();
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "no-store",
        "x-mxm-media-status": message.toLowerCase().replaceAll(" ", "-"),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}
export const GET = withApiErrors("app/api/gifts/media/[assetId]/route.ts:GET", GETHandler);
