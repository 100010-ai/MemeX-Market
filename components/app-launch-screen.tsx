"use client";

import { useEffect, useState } from "react";

export function AppLaunchScreen({ ready }: { ready: boolean }) {
  const [mounted, setMounted] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!ready) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const timer = window.setTimeout(() => setMounted(false), 620);
    return () => window.clearTimeout(timer);
  }, [ready]);

  if (!mounted) return null;

  return (
    <div className={`mxm-launch-screen ${leaving ? "is-leaving" : ""}`} aria-label="Загрузка MemeX Market" aria-live="polite">
      <div className="mxm-launch-grid" aria-hidden="true" />
      <div className="mxm-launch-orbit mxm-launch-orbit-a" aria-hidden="true" />
      <div className="mxm-launch-orbit mxm-launch-orbit-b" aria-hidden="true" />

      <div className="mxm-launch-content">
        <div className="mxm-launch-kicker">MEMEX</div>
        <div className="mxm-launch-title">MARKET</div>
        <p className="mxm-launch-caption">Виртуальный рынок внутри Telegram</p>
      </div>

      <div className="mxm-launch-footer">
        <div className="mxm-launch-progress"><span /></div>
        <div className="mxm-launch-status"><span>Подготавливаем рынок</span><span>MXM</span></div>
      </div>
    </div>
  );
}
