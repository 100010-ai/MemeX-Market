"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GiftAsset } from "@/lib/types";

export function GiftMedia({ gift, className = "", compact = false }: { gift: GiftAsset; className?: string; compact?: boolean }) {
  const animationRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const fileUrl = gift.modelFileId ? `/api/telegram/file/${encodeURIComponent(gift.modelFileId)}` : null;
  const thumbUrl = gift.symbolThumbFileId ? `/api/telegram/file/${encodeURIComponent(gift.symbolThumbFileId)}` : null;
  const pattern = useMemo(() => Array.from({ length: compact ? 4 : 8 }, (_, i) => i), [compact]);

  useEffect(() => {
    if (gift.mediaKind !== "animated" || !gift.modelFileId || !animationRef.current) return;
    let destroyed = false;
    let animation: { destroy: () => void } | null = null;
    Promise.all([
      import("lottie-web"),
      fetch(`/api/telegram/tgs/${encodeURIComponent(gift.modelFileId)}`, { cache: "force-cache" }).then(async (r) => {
        if (!r.ok) throw new Error("Animation unavailable");
        return r.json();
      }),
    ]).then(([module, animationData]) => {
      if (destroyed || !animationRef.current) return;
      const lottie = module.default;
      animation = lottie.loadAnimation({ container: animationRef.current, renderer: "svg", loop: true, autoplay: true, animationData });
    }).catch(() => setFailed(true));
    return () => { destroyed = true; animation?.destroy(); };
  }, [gift.mediaKind, gift.modelFileId]);

  return (
    <div
      className={`relative isolate overflow-hidden ${className}`}
      style={{ background: `radial-gradient(circle at 50% 42%, ${gift.backdropCenter}, ${gift.backdropEdge})` }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.12]" aria-hidden>
        {thumbUrl ? pattern.map((i) => (
          <img key={i} src={thumbUrl} alt="" className="absolute h-8 w-8 object-contain" style={{ left: `${8 + (i % 3) * 38}%`, top: `${8 + Math.floor(i / 3) * 34}%`, transform: `rotate(${(i % 2 ? 1 : -1) * (8 + i * 5)}deg)` }} />
        )) : pattern.map((i) => (
          <span key={i} className="absolute text-lg" style={{ color: gift.backdropSymbol, left: `${8 + (i % 3) * 39}%`, top: `${8 + Math.floor(i / 3) * 34}%` }}>✦</span>
        ))}
      </div>

      <div className={`relative z-10 grid h-full w-full place-items-center ${compact ? "p-3" : "p-6"}`}>
        {gift.mediaKind === "demo" ? (
          <span className={compact ? "text-5xl" : "text-7xl"}>{gift.demoEmoji || "🎁"}</span>
        ) : gift.mediaKind === "video" && fileUrl && !failed ? (
          <video src={fileUrl} autoPlay loop muted playsInline onError={() => setFailed(true)} className="h-full w-full object-contain" />
        ) : gift.mediaKind === "animated" && !failed ? (
          <div ref={animationRef} className="h-full w-full" />
        ) : fileUrl && !failed ? (
          <img src={fileUrl} alt={`${gift.baseName} #${gift.number}`} onError={() => setFailed(true)} className="h-full w-full object-contain" />
        ) : (
          <div className="text-center text-xs text-white/70"><div className="text-4xl">🎁</div><div className="mt-2">Media unavailable</div></div>
        )}
      </div>
      <span className="absolute right-2 top-2 z-20 rounded-md border border-white/15 bg-black/25 px-1.5 py-1 text-[10px] text-white/85 backdrop-blur">VIRTUAL</span>
    </div>
  );
}
