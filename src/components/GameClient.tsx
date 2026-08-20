'use client';

import { useEffect, useRef, useState } from 'react';
import { GAME_SHELL } from '@/legacy/game-shell';
import { startPreloader } from '@/features/ui/preloader';
import { bootstrapSecureSession } from '@/features/auth/client';
import { DuelRoomClient } from '@/components/duels/DuelRoomClient';

declare global {
  interface Window {
    __AUTOSYNDICATE_CONTENT__?: { cars?: unknown[]; opponents?: unknown[]; settings?: Record<string, unknown> };
  }
}

export function GameClient() {
  const started = useRef(false);
  const [duelCode, setDuelCode] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const stopPreloader = startPreloader();

    void (async () => {
      try { await bootstrapSecureSession(); } catch (error) { if (error instanceof Error && error.message === 'PLAYER_BANNED') { setBlocked(true); stopPreloader(); return; } console.warn('secure Telegram session unavailable', error); }
      try {
        const response = await fetch('/api/game/bootstrap', { cache: 'no-store' });
        const payload = await response.json();
        if (response.ok && payload?.ok) window.__AUTOSYNDICATE_CONTENT__ = payload;
      } catch (error) { console.warn('game content bootstrap unavailable', error); }

      const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param || new URLSearchParams(window.location.search).get('tgWebAppStartParam') || '';
      if (startParam === 'admin') { window.location.replace('/admin'); return; }
      if (/^duel_[A-Za-z0-9_-]{12,32}$/.test(startParam)) setDuelCode(startParam.slice(5));
      await import('@/legacy/runtime');
    })();

    return () => stopPreloader();
  }, []);

  return <>
    <div id="game-root" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: GAME_SHELL }} />
    {duelCode && <DuelRoomClient code={duelCode} onClose={() => setDuelCode(null)} />}
    {blocked && <div className="account-blocked"><div><span>ДОСТУП ОГРАНИЧЕН</span><b>Участие в AutoSyndicate приостановлено</b><p>Если вы считаете это ошибкой, обратитесь в поддержку проекта.</p></div></div>}
  </>;
}
