"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GiftAsset, GiftMediaKind } from "@/lib/types";

function TelegramSticker({ fileId, kind, alt, className, onError, lazy = false }: { fileId: string; kind: GiftMediaKind; alt: string; className?: string; onError?: (message: string) => void; lazy?: boolean }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const lottieRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(!lazy);

  useEffect(() => {
    if (!lazy || visible || !holderRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "220px" });
    observer.observe(holderRef.current);
    return () => observer.disconnect();
  }, [lazy, visible]);

  useEffect(() => {
    setError(null);
    if (!visible || kind !== "animated" || !lottieRef.current) return;
    let destroyed = false;
    let animation: { destroy: () => void } | null = null;
    Promise.all([
      import("lottie-web"),
      fetch(`/api/telegram/tgs/${encodeURIComponent(fileId)}`, { cache: "force-cache" }).then(async (response) => {
        if (!response.ok) throw new Error(`Telegram media ${response.status}`);
        return response.json();
      }),
    ]).then(([module, animationData]) => {
      if (destroyed || !lottieRef.current) return;
      animation = module.default.loadAnimation({ container: lottieRef.current, renderer: "svg", loop: true, autoplay: true, animationData });
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "Не удалось отрисовать TGS";
      setError(message); onError?.(message);
    });
    return () => { destroyed = true; animation?.destroy(); };
  }, [fileId, kind, onError, visible]);

  const src = `/api/telegram/file/${encodeURIComponent(fileId)}`;
  if (error) return <div className={`grid place-items-center text-center text-[9px] leading-4 text-white/55 ${className || ""}`}>Медиа недоступно</div>;
  if (!visible) return <div ref={holderRef} className={className} aria-label={alt} />;
  if (kind === "video") return <video ref={holderRef as any} src={src} autoPlay loop muted playsInline preload={lazy ? "metadata" : "auto"} onError={() => { setError("Видео Telegram недоступно"); onError?.("Видео Telegram недоступно"); }} className={className} />;
  if (kind === "animated") return <div ref={(node) => { (lottieRef as any).current = node; (holderRef as any).current = node; }} aria-label={alt} className={className} />;
  return <img ref={holderRef as any} src={src} alt={alt} loading={lazy ? "lazy" : "eager"} decoding="async" onError={() => { setError("Изображение Telegram недоступно"); onError?.("Изображение Telegram недоступно"); }} className={className} />;
}

export function GiftMedia({ gift, className = "", compact = false }: { gift: GiftAsset; className?: string; compact?: boolean }) {
  const [modelError, setModelError] = useState<string | null>(null);
  const staticSymbolFileId = gift.symbolThumbFileId || (gift.symbolMediaKind === "static" ? gift.symbolFileId : null);
  const symbolUrl = staticSymbolFileId ? `/api/telegram/file/${encodeURIComponent(staticSymbolFileId)}` : null;
  const pattern = useMemo(() => Array.from({ length: compact ? 8 : 12 }, (_, i) => i), [compact]);
  const compactModelFileId = compact && gift.modelThumbFileId ? gift.modelThumbFileId : gift.modelFileId;
  const compactModelKind: GiftMediaKind = compact && gift.modelThumbFileId ? "static" : gift.mediaKind;

  return (
    <div className={`relative isolate overflow-hidden ${className}`} style={{ background: `radial-gradient(circle at 48% 38%, ${gift.backdropCenter} 0%, ${gift.backdropEdge} 100%)` }}>
      {symbolUrl ? <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.13]" aria-hidden>{pattern.map((i) => <span key={i} className="absolute h-7 w-7" style={{ left: `${-3 + (i % 4) * 31}%`, top: `${1 + Math.floor(i / 4) * 35}%`, transform: `rotate(${(i % 2 ? 1 : -1) * (7 + (i % 4) * 6)}deg)`, backgroundColor: gift.backdropSymbol, WebkitMaskImage: `url(${symbolUrl})`, maskImage: `url(${symbolUrl})`, WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center", WebkitMaskSize: "contain", maskSize: "contain" }} />)}</div> : !compact ? <div className="pointer-events-none absolute inset-0 grid place-items-center opacity-[0.10]" aria-hidden><TelegramSticker fileId={gift.symbolFileId} kind={gift.symbolMediaKind} alt="" className="h-[42%] w-[42%] object-contain" lazy /></div> : null}
      <div className={`relative z-10 grid h-full w-full place-items-center ${compact ? "p-[14%]" : "p-[13%]"}`}>
        {modelError ? <div className="rounded-2xl bg-black/20 px-3 py-2 text-center text-[9px] leading-4 text-white/65">Медиа недоступно</div> : <TelegramSticker fileId={compactModelFileId} kind={compactModelKind} alt={`${gift.baseName} #${gift.number}`} className="h-full w-full object-contain" onError={setModelError} lazy={compact} />}
      </div>
    </div>
  );
}
