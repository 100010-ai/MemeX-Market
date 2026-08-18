"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GiftAsset } from "@/lib/types";

export function GiftMedia({ gift, className = "", compact = false }: { gift: GiftAsset; className?: string; compact?: boolean }) {
  const animationRef = useRef<HTMLDivElement>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const fileUrl = `/api/telegram/file/${encodeURIComponent(gift.modelFileId)}`;
  const symbolUrl = gift.symbolThumbFileId ? `/api/telegram/file/${encodeURIComponent(gift.symbolThumbFileId)}` : null;
  const pattern = useMemo(() => Array.from({ length: compact ? 7 : 12 }, (_, i) => i), [compact]);

  useEffect(() => {
    setMediaError(null);
    if (gift.mediaKind !== "animated" || !animationRef.current) return;
    let destroyed = false;
    let animation: { destroy: () => void } | null = null;
    Promise.all([
      import("lottie-web"),
      fetch(`/api/telegram/tgs/${encodeURIComponent(gift.modelFileId)}`, { cache: "force-cache" }).then(async (response) => {
        if (!response.ok) throw new Error(`Telegram animation request failed (${response.status})`);
        return response.json();
      }),
    ]).then(([module, animationData]) => {
      if (destroyed || !animationRef.current) return;
      animation = module.default.loadAnimation({ container: animationRef.current, renderer: "svg", loop: true, autoplay: true, animationData });
    }).catch((error) => {
      setMediaError(error instanceof Error ? error.message : "Telegram animation could not be rendered");
    });
    return () => { destroyed = true; animation?.destroy(); };
  }, [gift.mediaKind, gift.modelFileId]);

  return (
    <div className={`relative isolate overflow-hidden ${className}`} style={{ background: `radial-gradient(circle at 48% 38%, ${gift.backdropCenter} 0%, ${gift.backdropEdge} 100%)` }}>
      {symbolUrl ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.13]" aria-hidden>
          {pattern.map((i) => (
            <span
              key={i}
              className="absolute h-6 w-6"
              style={{
                left: `${-2 + (i % 4) * 32}%`,
                top: `${2 + Math.floor(i / 4) * 37}%`,
                transform: `rotate(${(i % 2 ? 1 : -1) * (8 + (i % 4) * 7)}deg)`,
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
      ) : null}

      <div className={`relative z-10 grid h-full w-full place-items-center ${compact ? "p-[17%]" : "p-[15%]"}`}>
        {mediaError ? (
          <div className="max-w-[190px] text-center text-[10px] leading-4 text-white/70">Telegram media unavailable<br />{mediaError}</div>
        ) : gift.mediaKind === "video" ? (
          <video src={fileUrl} autoPlay loop muted playsInline onError={() => setMediaError("Video load failed")} className="h-full w-full object-contain" />
        ) : gift.mediaKind === "animated" ? (
          <div ref={animationRef} className="h-full w-full" />
        ) : (
          <img src={fileUrl} alt={`${gift.baseName} #${gift.number}`} onError={() => setMediaError("Image load failed")} className="h-full w-full object-contain" />
        )}
      </div>
    </div>
  );
}
