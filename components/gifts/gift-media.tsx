"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { GiftAsset } from "@/lib/types";

export function GiftMedia({ gift, className = "", compact = false }: { gift: GiftAsset; className?: string; compact?: boolean }) {
  const animationRef = useRef<HTMLDivElement>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const fileUrl = `/api/telegram/file/${encodeURIComponent(gift.modelFileId)}`;
  const symbolUrl = gift.symbolThumbFileId ? `/api/telegram/file/${encodeURIComponent(gift.symbolThumbFileId)}` : null;
  const pattern = useMemo(() => Array.from({ length: compact ? 5 : 9 }, (_, i) => i), [compact]);

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
    <div className={`relative isolate overflow-hidden ${className}`} style={{ background: `radial-gradient(circle at 50% 42%, ${gift.backdropCenter}, ${gift.backdropEdge})` }}>
      {symbolUrl ? (
        <div className="pointer-events-none absolute inset-0 opacity-[0.12]" aria-hidden>
          {pattern.map((i) => <img key={i} src={symbolUrl} alt="" className="absolute h-7 w-7 object-contain" style={{ left: `${7 + (i % 3) * 40}%`, top: `${7 + Math.floor(i / 3) * 32}%`, transform: `rotate(${(i % 2 ? 1 : -1) * (8 + i * 4)}deg)` }} />)}
        </div>
      ) : null}

      <div className={`relative z-10 grid h-full w-full place-items-center ${compact ? "p-3" : "p-6"}`}>
        {mediaError ? (
          <div className="max-w-[190px] text-center text-[11px] text-white/80"><AlertTriangle className="mx-auto mb-2" size={20} /><span>{mediaError}</span></div>
        ) : gift.mediaKind === "video" ? (
          <video src={fileUrl} autoPlay loop muted playsInline onError={() => setMediaError("Telegram video could not be loaded")} className="h-full w-full object-contain" />
        ) : gift.mediaKind === "animated" ? (
          <div ref={animationRef} className="h-full w-full" />
        ) : (
          <img src={fileUrl} alt={`${gift.baseName} #${gift.number}`} onError={() => setMediaError("Telegram image could not be loaded")} className="h-full w-full object-contain" />
        )}
      </div>
      <span className="absolute right-2 top-2 z-20 rounded-md border border-white/15 bg-black/30 px-1.5 py-1 text-[9px] font-medium tracking-wide text-white/90 backdrop-blur">VIRTUAL</span>
    </div>
  );
}
