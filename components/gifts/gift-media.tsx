"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GiftAsset, GiftMediaKind } from "@/lib/types";

async function loadLottieJson(source: string) {
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
}

function useNearViewport(lazy: boolean, ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(!lazy);
  useEffect(() => {
    if (!lazy || visible || !ref.current) return;
    if (!("IntersectionObserver" in window)) {
      queueMicrotask(() => setVisible(true));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "320px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [lazy, ref, visible]);
  return visible;
}

function TelegramSticker({ fileId, mediaUrl, kind, alt, className, onError, lazy = false }: { fileId: string; mediaUrl?: string | null; kind: GiftMediaKind; alt: string; className?: string; onError?: (message: string) => void; lazy?: boolean }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const lottieRef = useRef<HTMLDivElement>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const visible = useNearViewport(lazy, holderRef);
  const mediaKey = `${fileId}|${mediaUrl || ""}|${kind}`;
  const error = errorKey === mediaKey;

  useEffect(() => {
    if (!visible || kind !== "animated" || !lottieRef.current) return;
    let destroyed = false;
    let animation: { destroy: () => void } | null = null;
    const source = mediaUrl || `/api/telegram/tgs/${encodeURIComponent(fileId)}`;
    Promise.all([import("lottie-web"), loadLottieJson(source)]).then(([module, animationData]) => {
      if (destroyed || !lottieRef.current) return;
      animation = module.default.loadAnimation({ container: lottieRef.current, renderer: "svg", loop: true, autoplay: true, animationData });
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "Не удалось отрисовать TGS";
      setErrorKey(mediaKey);
      onError?.(message);
    });
    return () => {
      destroyed = true;
      animation?.destroy();
    };
  }, [fileId, mediaUrl, kind, mediaKey, onError, visible]);

  const src = mediaUrl || `/api/telegram/file/${encodeURIComponent(fileId)}`;
  if (error) return <div className={`grid place-items-center text-center text-[9px] leading-4 text-white/55 ${className || ""}`}>Медиа недоступно</div>;
  if (!visible) return <div ref={holderRef} className={className} aria-label={alt} />;
  if (kind === "video") return <video src={src} autoPlay loop muted playsInline preload={lazy ? "metadata" : "auto"} onError={() => { setErrorKey(mediaKey); onError?.("Видео Telegram недоступно"); }} className={className} />;
  if (kind === "animated") return <div ref={(node) => { lottieRef.current = node; holderRef.current = node; }} aria-label={alt} className={className} />;
  return <img src={src} alt={alt} loading={lazy ? "lazy" : "eager"} decoding="async" onError={() => { setErrorKey(mediaKey); onError?.("Изображение Telegram недоступно"); }} className={className} />;
}

function TonApiMedia({ gift, compact }: { gift: GiftAsset; compact: boolean }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const lottieRef = useRef<HTMLDivElement>(null);
  const [animationFailedKey, setAnimationFailedKey] = useState<string | null>(null);
  const [animationReadyKey, setAnimationReadyKey] = useState<string | null>(null);
  const [previewFailedKey, setPreviewFailedKey] = useState<string | null>(null);
  const visible = useNearViewport(compact, holderRef);
  const previewSource = `/api/gifts/media/${encodeURIComponent(gift.id)}?variant=preview`;
  const animationFailed = animationFailedKey === gift.id;
  const animationReady = animationReadyKey === gift.id;
  const previewFailed = previewFailedKey === gift.id;

  useEffect(() => {
    if (!visible || animationFailed || !lottieRef.current) return;
    let destroyed = false;
    let animation: { destroy: () => void } | null = null;
    const animationSource = `/api/gifts/media/${encodeURIComponent(gift.id)}?variant=animation`;

    Promise.all([import("lottie-web"), loadLottieJson(animationSource)]).then(([module, animationData]) => {
      if (destroyed || !lottieRef.current) return;
      animation = module.default.loadAnimation({
        container: lottieRef.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        animationData,
        rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
      });
      requestAnimationFrame(() => {
        if (!destroyed) setAnimationReadyKey(gift.id);
      });
    }).catch(() => {
      if (!destroyed) {
        setAnimationFailedKey(gift.id);
      }
    });

    return () => {
      destroyed = true;
      animation?.destroy();
    };
  }, [animationFailed, gift.id, visible]);

  const storedPreview = gift.modelPreviewUrl || (gift.mediaKind === "static" ? gift.modelMediaUrl : null);

  return (
    <div ref={holderRef} className="relative h-full w-full overflow-hidden bg-[#0b0d0f]">
      {!previewFailed ? (
        <img
          src={previewSource}
          alt={`${gift.baseName} #${gift.number}`}
          loading={compact ? "lazy" : "eager"}
          decoding="async"
          onError={() => setPreviewFailedKey(gift.id)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${animationReady ? "opacity-0" : "opacity-100"}`}
        />
      ) : storedPreview ? (
        <img
          src={storedPreview}
          alt={`${gift.baseName} #${gift.number}`}
          loading={compact ? "lazy" : "eager"}
          decoding="async"
          referrerPolicy="no-referrer"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${animationReady ? "opacity-0" : "opacity-100"}`}
        />
      ) : null}

      {visible && !animationFailed ? (
        <div
          ref={lottieRef}
          aria-label={`${gift.baseName} #${gift.number}`}
          className="absolute inset-0 h-full w-full"
        />
      ) : null}

      {previewFailed && !storedPreview && (animationFailed || !visible) ? (
        <div className="absolute inset-0 grid place-items-center text-center text-[9px] leading-4 text-white/55">Медиа недоступно</div>
      ) : null}
    </div>
  );
}

export function GiftMedia({ gift, className = "", compact = false }: { gift: GiftAsset; className?: string; compact?: boolean }) {
  const [modelError, setModelError] = useState<string | null>(null);
  const pattern = useMemo(() => Array.from({ length: compact ? 8 : 12 }, (_, i) => i), [compact]);

  if (gift.catalogSource === "tonapi") {
    return (
      <div className={`relative isolate overflow-hidden bg-[#0b0d0f] ${className}`}>
        <TonApiMedia gift={gift} compact={compact} />
      </div>
    );
  }

  const staticSymbolFileId = gift.symbolThumbFileId || (gift.symbolMediaKind === "static" ? gift.symbolFileId : null);
  const symbolUrl = gift.symbolMediaUrl && gift.symbolMediaKind === "static"
    ? gift.symbolMediaUrl
    : staticSymbolFileId ? `/api/telegram/file/${encodeURIComponent(staticSymbolFileId)}` : null;
  // Mirrored Telegram media is already CDN-ready, so do not replace it with a
  // Bot API thumbnail whose file ID may belong to a different Telegram source.
  const compactModelFileId = compact && !gift.modelMediaUrl && gift.modelThumbFileId ? gift.modelThumbFileId : gift.modelFileId;
  const compactModelKind: GiftMediaKind = compact && !gift.modelMediaUrl && gift.modelThumbFileId ? "static" : gift.mediaKind;

  return (
    <div className={`relative isolate overflow-hidden ${className}`} style={{ background: `radial-gradient(circle at 48% 38%, ${gift.backdropCenter} 0%, ${gift.backdropEdge} 100%)` }}>
      {symbolUrl ? <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.13]" aria-hidden>{pattern.map((i) => <span key={i} className="absolute h-7 w-7" style={{ left: `${-3 + (i % 4) * 31}%`, top: `${1 + Math.floor(i / 4) * 35}%`, transform: `rotate(${(i % 2 ? 1 : -1) * (7 + (i % 4) * 6)}deg)`, backgroundColor: gift.backdropSymbol, WebkitMaskImage: `url(${symbolUrl})`, maskImage: `url(${symbolUrl})`, WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center", WebkitMaskSize: "contain", maskSize: "contain" }} />)}</div> : !compact ? <div className="pointer-events-none absolute inset-0 grid place-items-center opacity-[0.10]" aria-hidden><TelegramSticker fileId={gift.symbolFileId} mediaUrl={gift.symbolMediaUrl} kind={gift.symbolMediaKind} alt="" className="h-[42%] w-[42%] object-contain" lazy /></div> : null}
      <div className={`relative z-10 grid h-full w-full place-items-center ${compact ? "p-[14%]" : "p-[13%]"}`}>
        {modelError ? <div className="rounded-2xl bg-black/20 px-3 py-2 text-center text-[9px] leading-4 text-white/65">Медиа недоступно</div> : <TelegramSticker fileId={compactModelFileId} mediaUrl={gift.modelMediaUrl} kind={compactModelKind} alt={`${gift.baseName} #${gift.number}`} className="h-full w-full object-contain" onError={setModelError} lazy={compact} />}
      </div>
    </div>
  );
}
