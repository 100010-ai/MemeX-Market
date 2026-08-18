"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GiftAsset, GiftMediaKind } from "@/lib/types";

function TelegramSticker({ fileId, kind, alt, className, onError }: { fileId: string; kind: GiftMediaKind; alt: string; className?: string; onError?: (message: string) => void }) {
  const lottieRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (kind !== "animated" || !lottieRef.current) return;
    let destroyed = false;
    let animation: { destroy: () => void } | null = null;
    Promise.all([
      import("lottie-web"),
      fetch(`/api/telegram/tgs/${encodeURIComponent(fileId)}`, { cache: "force-cache" }).then(async (response) => {
        if (!response.ok) throw new Error(`Telegram TGS request failed (${response.status})`);
        return response.json();
      }),
    ]).then(([module, animationData]) => {
      if (destroyed || !lottieRef.current) return;
      animation = module.default.loadAnimation({ container: lottieRef.current, renderer: "svg", loop: true, autoplay: true, animationData });
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "Telegram TGS render failed";
      setError(message);
      onError?.(message);
    });
    return () => { destroyed = true; animation?.destroy(); };
  }, [fileId, kind, onError]);

  const src = `/api/telegram/file/${encodeURIComponent(fileId)}`;
  if (error) return <div className={`grid place-items-center text-center text-[10px] leading-4 text-white/65 ${className || ""}`}>{error}</div>;
  if (kind === "video") return <video src={src} autoPlay loop muted playsInline onError={() => { setError("Telegram video load failed"); onError?.("Telegram video load failed"); }} className={className} />;
  if (kind === "animated") return <div ref={lottieRef} aria-label={alt} className={className} />;
  return <img src={src} alt={alt} onError={() => { setError("Telegram image load failed"); onError?.("Telegram image load failed"); }} className={className} />;
}

export function GiftMedia({ gift, className = "", compact = false }: { gift: GiftAsset; className?: string; compact?: boolean }) {
  const [modelError, setModelError] = useState<string | null>(null);
  const staticSymbolFileId = gift.symbolThumbFileId || (gift.symbolMediaKind === "static" ? gift.symbolFileId : null);
  const symbolUrl = staticSymbolFileId ? `/api/telegram/file/${encodeURIComponent(staticSymbolFileId)}` : null;
  const pattern = useMemo(() => Array.from({ length: compact ? 8 : 12 }, (_, i) => i), [compact]);

  return (
    <div
      className={`relative isolate overflow-hidden ${className}`}
      style={{ background: `radial-gradient(circle at 48% 38%, ${gift.backdropCenter} 0%, ${gift.backdropEdge} 100%)` }}
    >
      {symbolUrl ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.14]" aria-hidden>
          {pattern.map((i) => (
            <span
              key={i}
              className="absolute h-7 w-7"
              style={{
                left: `${-3 + (i % 4) * 31}%`,
                top: `${1 + Math.floor(i / 4) * 35}%`,
                transform: `rotate(${(i % 2 ? 1 : -1) * (7 + (i % 4) * 6)}deg)`,
                backgroundColor: gift.backdropSymbol,
                WebkitMaskImage: `url(${symbolUrl})`,
                maskImage: `url(${symbolUrl})`,
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
                WebkitMaskSize: "contain",
                maskSize: "contain",
              }}
            />
          ))}
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 grid place-items-center opacity-[0.11]" aria-hidden>
          <TelegramSticker fileId={gift.symbolFileId} kind={gift.symbolMediaKind} alt="" className="h-[42%] w-[42%] object-contain" />
        </div>
      )}

      <div className={`relative z-10 grid h-full w-full place-items-center ${compact ? "p-[15%]" : "p-[13%]"}`}>
        {modelError ? (
          <div className="max-w-[210px] rounded-md bg-black/20 px-3 py-2 text-center text-[10px] leading-4 text-white/75">Telegram media error<br />{modelError}</div>
        ) : (
          <TelegramSticker
            fileId={gift.modelFileId}
            kind={gift.mediaKind}
            alt={`${gift.baseName} #${gift.number}`}
            className="h-full w-full object-contain"
            onError={setModelError}
          />
        )}
      </div>
    </div>
  );
}
