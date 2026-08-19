"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";

/**
 * Bottom-sheet shell for intercepted routes (the `@modal` parallel slot).
 * Renders the wrapped route as a dismissible overlay over whatever page is
 * underneath, and closes by going back in history — landing back on the
 * page that triggered the navigation. Direct links / refreshes never reach
 * this component; Next.js renders the full page route instead.
 */
export function RouteModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const close = useCallback(() => router.back(), [router]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [close]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:items-center">
      <button
        aria-label="Закрыть"
        onClick={close}
        className="mxm-sheet-backdrop mxm-overlay-backdrop absolute inset-0 bg-black/72"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="mxm-sheet-panel relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-[28px] border border-[var(--border)] bg-[var(--bg)] p-3 pb-[calc(12px+env(safe-area-inset-bottom))] shadow-[0_-16px_48px_rgba(0,0,0,.5)] md:rounded-[28px] md:pb-3"
      >
        <div className="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-[var(--border)] md:hidden" />
        {children}
      </div>
    </div>
  );
}
