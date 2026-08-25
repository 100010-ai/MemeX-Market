"use client";

import { useEffect, useState } from "react";

const MAX_PENDING_PROGRESS = 94;
let sharedLaunchProgress = 0;
let sharedLaunchStartedAt = 0;

function nextPendingProgress(elapsedMs: number) {
  // Monotonic progress while the Telegram session is being authenticated. It
  // never loops or moves backwards.
  const normalized = 1 - Math.exp(-elapsedMs / 1100);
  return Math.min(MAX_PENDING_PROGRESS, Math.max(4, Math.round(normalized * MAX_PENDING_PROGRESS)));
}

export function AppLaunchScreen({ ready }: { ready: boolean }) {
  const [mounted, setMounted] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [progress, setProgress] = useState(() => sharedLaunchProgress);

  useEffect(() => {
    if (!sharedLaunchStartedAt) sharedLaunchStartedAt = performance.now();

    if (ready) {
      sharedLaunchProgress = 100;
      setProgress(100);

      const leaveTimer = window.setTimeout(() => setLeaving(true), 80);
      const unmountTimer = window.setTimeout(() => setMounted(false), 360);
      return () => {
        window.clearTimeout(leaveTimer);
        window.clearTimeout(unmountTimer);
      };
    }

    setMounted(true);
    setLeaving(false);

    const update = () => {
      const candidate = nextPendingProgress(performance.now() - sharedLaunchStartedAt);
      if (candidate <= sharedLaunchProgress) return;
      sharedLaunchProgress = candidate;
      setProgress(candidate);
    };

    update();
    const timer = window.setInterval(update, 90);
    return () => window.clearInterval(timer);
  }, [ready]);

  if (!mounted) return null;

  return (
    <div className={`mxm-launch-screen ${leaving ? "is-leaving" : ""}`} aria-label="Загрузка MemeX Market" aria-live="polite">
      <div className="mxm-launch-content">
        <div className="mxm-launch-brand">MEMEX MARKET</div>
      </div>

      <div className="mxm-launch-footer">
        <div className="mxm-launch-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="mxm-launch-status">
          <span>Загрузка</span>
          <span>{progress}%</span>
        </div>
      </div>
    </div>
  );
}
