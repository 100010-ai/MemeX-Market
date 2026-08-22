"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { GiftAsset, GiftMediaKind } from "@/lib/types";
import { fragmentGiftMedia, telegramCollectibleSlug } from "@/lib/fragment-gifts";

type LottieAnimation = {
  destroy: () => void;
  play: () => void;
  pause: () => void;
  addEventListener?: (name: string, callback: () => void) => void;
  removeEventListener?: (name: string, callback: () => void) => void;
};

type DeviceMemoryNavigator = Navigator & { deviceMemory?: number };

const LOTTIE_CACHE_LIMIT = 10;
const lottieJsonCache = new Map<string, Promise<unknown>>();
let lottieModulePromise: Promise<typeof import("lottie-web")> | null = null;

function loadLottieModule() {
  lottieModulePromise ??= import("lottie-web").then((module) => {
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    module.default.setQuality(coarse ? "low" : "medium");
    return module;
  });
  return lottieModulePromise;
}

function rememberLottie(source: string, task: Promise<unknown>) {
  lottieJsonCache.delete(source);
  lottieJsonCache.set(source, task);
  while (lottieJsonCache.size > LOTTIE_CACHE_LIMIT) {
    const oldest = lottieJsonCache.keys().next().value as string | undefined;
    if (!oldest) break;
    lottieJsonCache.delete(oldest);
  }
  return task;
}

async function loadLottieJson(source: string) {
  const cached = lottieJsonCache.get(source);
  if (cached) {
    lottieJsonCache.delete(source);
    lottieJsonCache.set(source, cached);
    return cached;
  }

  const task = (async () => {
    const response = await fetch(source, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Media ${response.status}`);

    const buffer = await response.arrayBuffer();
    let bytes = new Uint8Array(buffer);
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (isGzip) {
      const Decompression = (globalThis as typeof globalThis & { DecompressionStream?: new (format: string) => TransformStream }).DecompressionStream;
      if (!Decompression) throw new Error("TGS decompression is unavailable in this WebView");
      const stream = new Blob([bytes]).stream().pipeThrough(new Decompression("gzip"));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }

    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid Lottie payload");
    return parsed;
  })();

  task.catch(() => {
    if (lottieJsonCache.get(source) === task) lottieJsonCache.delete(source);
  });
  return rememberLottie(source, task);
}

type ObserverCallback = (visible: boolean) => void;
const nearCallbacks = new WeakMap<Element, ObserverCallback>();
const activeCallbacks = new WeakMap<Element, ObserverCallback>();
let nearObserver: IntersectionObserver | null = null;
let activeObserver: IntersectionObserver | null = null;

function getNearObserver() {
  if (nearObserver || typeof window === "undefined" || !("IntersectionObserver" in window)) return nearObserver;
  nearObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) nearCallbacks.get(entry.target)?.(entry.isIntersecting);
  }, { rootMargin: "120px 0px", threshold: 0 });
  return nearObserver;
}

function getActiveObserver() {
  if (activeObserver || typeof window === "undefined" || !("IntersectionObserver" in window)) return activeObserver;
  activeObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) activeCallbacks.get(entry.target)?.(entry.isIntersecting && entry.intersectionRatio > 0);
  }, { rootMargin: "24px 0px", threshold: 0.01 });
  return activeObserver;
}

function useViewportState(lazy: boolean, ref: RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(!lazy);
  const [active, setActive] = useState(!lazy);

  useEffect(() => {
    const node = ref.current;
    if (!node || !lazy) return;
    if (!("IntersectionObserver" in window)) {
      queueMicrotask(() => {
        setNear(true);
        setActive(true);
      });
      return;
    }

    const nearIo = getNearObserver();
    const activeIo = getActiveObserver();
    const onNear: ObserverCallback = (isNear) => {
      if (isNear) setNear(true);
    };
    const onActive: ObserverCallback = setActive;
    nearCallbacks.set(node, onNear);
    activeCallbacks.set(node, onActive);
    nearIo?.observe(node);
    activeIo?.observe(node);

    return () => {
      nearIo?.unobserve(node);
      activeIo?.unobserve(node);
      nearCallbacks.delete(node);
      activeCallbacks.delete(node);
    };
  }, [lazy, ref]);

  return { near, active };
}

let motionRuntimeReady = false;
let motionPaused = false;
let scrollTimer: number | null = null;
const motionListeners = new Set<(paused: boolean) => void>();

function publishMotionState(next: boolean) {
  if (motionPaused === next) return;
  motionPaused = next;
  for (const listener of motionListeners) listener(next);
}

function ensureMotionRuntime() {
  if (motionRuntimeReady || typeof window === "undefined") return;
  motionRuntimeReady = true;

  const updateVisibility = () => publishMotionState(document.visibilityState === "hidden");
  const onScroll = () => {
    if (document.visibilityState === "hidden") return;
    publishMotionState(true);
    if (scrollTimer != null) window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      scrollTimer = null;
      publishMotionState(document.visibilityState === "hidden");
    }, 110);
  };

  document.addEventListener("visibilitychange", updateVisibility, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("touchmove", onScroll, { passive: true });
  updateVisibility();
}

function subscribeMotion(listener: (paused: boolean) => void) {
  ensureMotionRuntime();
  motionListeners.add(listener);
  listener(motionPaused);
  return () => { motionListeners.delete(listener); };
}

const permitListeners = new Map<string, (granted: boolean) => void>();
let permitLimit: number | null = null;

function animationLimit() {
  if (permitLimit != null) return permitLimit;
  if (typeof navigator === "undefined") return 3;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as DeviceMemoryNavigator).deviceMemory || 4;
  const coarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  permitLimit = coarsePointer ? (cores <= 6 || memory <= 6 ? 1 : 2) : cores <= 4 || memory <= 4 ? 2 : cores <= 6 || memory <= 6 ? 3 : 4;
  return permitLimit;
}

function refreshPermits() {
  const allowed = new Set([...permitListeners.keys()].slice(0, animationLimit()));
  for (const [key, listener] of permitListeners) listener(allowed.has(key));
}

export function getGiftMediaPerfSnapshot() {
  const allowed = Math.min(permitListeners.size, animationLimit());
  return {
    animationCandidates: permitListeners.size,
    animationPermits: allowed,
    animationLimit: animationLimit(),
    lottieCacheEntries: lottieJsonCache.size,
    motionPaused,
  };
}

function useAnimationPermit(enabled: boolean, key: string, limited: boolean) {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    if (!limited || !enabled) return;
    permitListeners.set(key, setGranted);
    refreshPermits();
    return () => {
      permitListeners.delete(key);
      setGranted(false);
      refreshPermits();
    };
  }, [enabled, key, limited]);
  return limited ? enabled && granted : enabled;
}

function TelegramSticker({ fileId, mediaUrl, kind, alt, className, onError, lazy = false }: { fileId?: string | null; mediaUrl?: string | null; kind: GiftMediaKind; alt: string; className?: string; onError?: (message: string) => void; lazy?: boolean }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const lottieRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<LottieAnimation | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const { near, active } = useViewportState(lazy, holderRef);
  const mediaKey = `${fileId || ""}|${mediaUrl || ""}|${kind}`;
  const error = errorKey === mediaKey;
  const permitted = useAnimationPermit(active && (kind === "animated" || kind === "video"), `telegram:${mediaKey}`, lazy);

  useEffect(() => {
    if (!near || !permitted || kind !== "animated" || !lottieRef.current) return;
    let destroyed = false;
    let animation: LottieAnimation | null = null;
    let unsubscribeMotion: (() => void) | null = null;
    const source = mediaUrl || (fileId ? `/api/telegram/tgs/${encodeURIComponent(fileId)}` : null);
    if (!source) return;

    Promise.all([loadLottieModule(), loadLottieJson(source)]).then(([module, animationData]) => {
      if (destroyed || !lottieRef.current) return;
      animation = module.default.loadAnimation({
        container: lottieRef.current,
        renderer: lazy ? "canvas" : "svg",
        loop: true,
        autoplay: false,
        animationData,
        rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
      }) as LottieAnimation;
      animationRef.current = animation;
      unsubscribeMotion = subscribeMotion((paused) => {
        if (!animation) return;
        if (paused) animation.pause();
        else animation.play();
      });
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "Не удалось отрисовать TGS";
      setErrorKey(mediaKey);
      onError?.(message);
    });

    return () => {
      destroyed = true;
      unsubscribeMotion?.();
      if (animationRef.current === animation) animationRef.current = null;
      animation?.destroy();
    };
  }, [fileId, mediaUrl, kind, mediaKey, onError, near, lazy, permitted]);

  useEffect(() => {
    if (!near || !permitted || kind !== "video" || !videoRef.current) return;
    const video = videoRef.current;
    return subscribeMotion((paused) => {
      if (paused) video.pause();
      else void video.play().catch(() => undefined);
    });
  }, [kind, near, permitted]);

  const safeMediaUrl = mediaUrl && /^(https?:|data:)/.test(mediaUrl) ? mediaUrl : null;
  const src = safeMediaUrl || (fileId && !fileId.startsWith("tonapi:") ? `/api/telegram/file/${encodeURIComponent(fileId)}` : null);
  return (
    <div ref={holderRef} className={className} aria-label={alt}>
      {error || !src ? <div className="grid h-full w-full place-items-center text-center text-[9px] leading-4 text-white/55">Медиа недоступно</div> : !near ? null : kind === "video" ? (
        <video ref={videoRef} src={src} loop muted playsInline preload={lazy ? "metadata" : "auto"} onError={() => { setErrorKey(mediaKey); onError?.("Видео Telegram недоступно"); }} className="h-full w-full object-contain" />
      ) : kind === "animated" ? (
        <div ref={lottieRef} className="h-full w-full" />
      ) : (
        <Image src={src} alt={alt} width={512} height={512} unoptimized loading={lazy ? "lazy" : "eager"} decoding="async" onError={() => { setErrorKey(mediaKey); onError?.("Изображение Telegram недоступно"); }} className="h-full w-full object-contain" />
      )}
    </div>
  );
}

function TonApiMedia({ gift, compact, priority }: { gift: GiftAsset; compact: boolean; priority: boolean }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const lottieRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<LottieAnimation | null>(null);
  const [animationFailedKey, setAnimationFailedKey] = useState<string | null>(null);
  const [animationReadyKey, setAnimationReadyKey] = useState<string | null>(null);
  const [previewFailedKey, setPreviewFailedKey] = useState<string | null>(null);
  const { near, active } = useViewportState(compact, holderRef);
  const wantsAnimation = gift.mediaKind === "animated";
  const animationFailed = animationFailedKey === gift.id;
  const animationReady = animationReadyKey === gift.id;
  const previewFailed = previewFailedKey === gift.id;
  const permitted = useAnimationPermit(active && wantsAnimation && !animationFailed, `tonapi:${gift.id}`, compact);
  const fragmentSlug = telegramCollectibleSlug(gift.telegramName, gift.baseName, gift.number);
  const fragmentMedia = fragmentSlug ? fragmentGiftMedia(fragmentSlug) : null;
  // Always use our media proxy for Telegram collectible previews. Fragment URLs
  // can reject embedded WebView requests and expose CORS/referrer issues.
  // The proxy validates the source and serves the original collectible render.
  const previewSource = compact
    ? `/api/gifts/media/${encodeURIComponent(gift.id)}?variant=preview&size=medium${fragmentSlug ? `&slug=${encodeURIComponent(fragmentSlug)}` : ""}`
    : `/api/gifts/media/${encodeURIComponent(gift.id)}?variant=preview&size=large${fragmentSlug ? `&slug=${encodeURIComponent(fragmentSlug)}` : ""}`;

  useEffect(() => {
    if (!near || !wantsAnimation || animationFailed || !permitted || !lottieRef.current) return;
    let destroyed = false;
    let animation: LottieAnimation | null = null;
    let unsubscribeMotion: (() => void) | null = null;
    const slug = telegramCollectibleSlug(gift.telegramName, gift.baseName, gift.number);
    const slugQuery = slug ? `&slug=${encodeURIComponent(slug)}` : "";
    const animationSource = `/api/gifts/media/${encodeURIComponent(gift.id)}?variant=animation${slugQuery}`;
    const settleDelay = compact ? 180 : 0;
    const timer = window.setTimeout(() => {
      Promise.all([loadLottieModule(), loadLottieJson(animationSource)]).then(([module, animationData]) => {
      if (destroyed || !lottieRef.current) return;
      animation = module.default.loadAnimation({
        container: lottieRef.current,
        renderer: compact ? "canvas" : "svg",
        loop: true,
        autoplay: false,
        animationData,
        rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
      }) as LottieAnimation;
      animationRef.current = animation;
      const onReady = () => {
        if (!destroyed) setAnimationReadyKey(gift.id);
      };
      animation.addEventListener?.("DOMLoaded", onReady);
      window.requestAnimationFrame(onReady);
      unsubscribeMotion = subscribeMotion((paused) => {
        if (!animation) return;
        if (paused) animation.pause();
        else animation.play();
      });
      }).catch(() => {
        if (!destroyed) setAnimationFailedKey(gift.id);
      });
    }, settleDelay);

    return () => {
      destroyed = true;
      window.clearTimeout(timer);
      unsubscribeMotion?.();
      if (animationRef.current === animation) animationRef.current = null;
      animation?.destroy();
    };
  }, [animationFailed, compact, gift.baseName, gift.id, gift.number, gift.telegramName, near, permitted, wantsAnimation]);

  const storedPreview = gift.modelPreviewUrl || (gift.mediaKind === "static" ? gift.modelMediaUrl : null);
  const showAnimation = wantsAnimation && permitted && !animationFailed;

  return (
    <div ref={holderRef} className="mxm-gift-media relative h-full w-full overflow-hidden bg-[#0b0d0f]">
      {!previewFailed ? (
        <Image
          src={previewSource}
          alt={`${gift.baseName} #${gift.number}`}
          width={768}
          height={768}
          unoptimized
          loading={priority ? "eager" : compact ? "lazy" : "eager"}
          decoding="async"
          fetchPriority={priority || !compact ? "high" : "low"}
          onError={() => setPreviewFailedKey(gift.id)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ease-out ${animationReady && showAnimation ? "opacity-0" : "opacity-100"}`}
        />
      ) : storedPreview ? (
        <Image
          src={storedPreview}
          alt={`${gift.baseName} #${gift.number}`}
          width={768}
          height={768}
          unoptimized
          loading={priority ? "eager" : compact ? "lazy" : "eager"}
          decoding="async"
          fetchPriority={priority || !compact ? "high" : "low"}
          referrerPolicy="no-referrer"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ease-out ${animationReady && showAnimation ? "opacity-0" : "opacity-100"}`}
        />
      ) : null}

      {showAnimation ? (
        <div
          ref={lottieRef}
          aria-label={`${gift.baseName} #${gift.number}`}
          className="absolute inset-0 h-full w-full"
        />
      ) : null}

      {previewFailed && !storedPreview && (!wantsAnimation || animationFailed || !near) ? (
        <div className="absolute inset-0 grid place-items-center text-center text-[9px] leading-4 text-white/55">Медиа недоступно</div>
      ) : null}
    </div>
  );
}

export function GiftMedia({ gift, className = "", compact = false, priority = false }: { gift: GiftAsset; className?: string; compact?: boolean; priority?: boolean }) {
  const [modelError, setModelError] = useState<string | null>(null);
  const pattern = useMemo(() => Array.from({ length: compact ? 6 : 10 }, (_, i) => i), [compact]);

  if (gift.catalogSource === "tonapi") {
    return (
      <div className={`mxm-gift-media relative isolate overflow-hidden bg-[#0b0d0f] ${className}`}>
        <TonApiMedia gift={gift} compact={compact} priority={priority} />
      </div>
    );
  }

  const staticSymbolFileId = gift.symbolThumbFileId || (gift.symbolMediaKind === "static" ? gift.symbolFileId : null);
  const safeSymbolFileId = staticSymbolFileId && !staticSymbolFileId.startsWith("tonapi:")
    ? staticSymbolFileId
    : null;
  const symbolUrl = gift.symbolMediaUrl && gift.symbolMediaKind === "static" && /^(https?:|data:)/.test(gift.symbolMediaUrl)
    ? gift.symbolMediaUrl
    : safeSymbolFileId ? `/api/telegram/file/${encodeURIComponent(safeSymbolFileId)}` : null;
  const compactModelFileId = compact && !gift.modelMediaUrl && gift.modelThumbFileId ? gift.modelThumbFileId : gift.modelFileId;
  const compactModelKind: GiftMediaKind = compact && !gift.modelMediaUrl && gift.modelThumbFileId ? "static" : gift.mediaKind;

  return (
    <div className={`mxm-gift-media relative isolate overflow-hidden ${className}`} style={{ background: `radial-gradient(circle at 48% 38%, ${gift.backdropCenter} 0%, ${gift.backdropEdge} 100%)` }}>
      {symbolUrl ? <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.13]" aria-hidden>{pattern.map((i) => <span key={i} className="absolute h-7 w-7" style={{ left: `${-3 + (i % 4) * 31}%`, top: `${1 + Math.floor(i / 4) * 38}%`, transform: `rotate(${(i % 2 ? 1 : -1) * (7 + (i % 4) * 6)}deg)`, backgroundColor: gift.backdropSymbol, WebkitMaskImage: `url(${symbolUrl})`, maskImage: `url(${symbolUrl})`, WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center", WebkitMaskSize: "contain", maskSize: "contain" }} />)}</div> : !compact && (safeSymbolFileId || gift.symbolMediaUrl) ? <div className="pointer-events-none absolute inset-0 grid place-items-center opacity-[0.10]" aria-hidden><TelegramSticker fileId={safeSymbolFileId} mediaUrl={gift.symbolMediaUrl} kind={gift.symbolMediaKind} alt="" className="h-[42%] w-[42%]" lazy /></div> : null}
      <div className={`relative z-10 grid h-full w-full place-items-center ${compact ? "p-[14%]" : "p-[13%]"}`}>
        {modelError ? <div className="rounded-2xl bg-black/20 px-3 py-2 text-center text-[9px] leading-4 text-white/65">Медиа недоступно</div> : <TelegramSticker fileId={compactModelFileId} mediaUrl={gift.modelMediaUrl} kind={compactModelKind} alt={`${gift.baseName} #${gift.number}`} className="h-full w-full" onError={setModelError} lazy={compact && !priority} />}
      </div>
    </div>
  );
}
