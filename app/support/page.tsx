"use client";

import { useState } from "react";
import { Gem, Star } from "lucide-react";
import { STAR_PACKAGES } from "@/lib/economy";
import { apiFetch } from "@/lib/api";
import { useTelegramProfile } from "@/components/telegram-provider";

export default function SupportPage() {
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { refreshProfile, haptic } = useTelegramProfile();

  async function buy(stars: number) {
    if (busy) return;
    setBusy(stars); setNotice(null); haptic("medium");
    try {
      const invoice = await apiFetch<{ purchaseId: string; invoiceUrl: string; virtualTon: number }>("/api/stars/invoice", { method: "POST", body: JSON.stringify({ stars }) });
      const webApp = window.Telegram?.WebApp;
      if (!webApp?.openInvoice) throw new Error("Открой MXM внутри актуального Telegram");
      webApp.openInvoice(invoice.invoiceUrl, (status) => {
        if (status !== "paid") { setBusy(null); setNotice(status === "cancelled" ? "Оплата отменена" : "Платёж не завершён"); return; }
        setNotice("Платёж принят Telegram. Подтверждаем начисление…");
        let tries = 0;
        const poll = async () => {
          tries += 1;
          try {
            const result = await apiFetch<{ purchase: { status: string; virtualTon: number } }>(`/api/stars/status/${invoice.purchaseId}`, { cacheMs: 0 });
            if (result.purchase.status === "paid") {
              await refreshProfile(); setNotice(`Начислено ${result.purchase.virtualTon.toLocaleString("ru-RU")} виртуальных TON`); setBusy(null); haptic("heavy"); return;
            }
          } catch { /* webhook can arrive slightly later */ }
          if (tries < 14) window.setTimeout(poll, 800); else { setNotice("Telegram подтвердил оплату. Начисление появится после webhook-подтверждения."); setBusy(null); }
        };
        void poll();
      });
    } catch (e) { setNotice(e instanceof Error ? e.message : "Не удалось открыть Stars"); setBusy(null); }
  }

  return <div className="mx-auto max-w-3xl">
    <header className="mb-5 border-b border-[var(--border-soft)] pb-4"><p className="text-[10px] uppercase tracking-[.14em] text-[var(--muted-2)]">Telegram Stars</p><h1 className="mt-1 text-[20px] font-semibold tracking-[-.035em]">Пополнить MXM</h1><p className="mt-1.5 text-[11px] leading-5 text-[var(--muted)]">Поддержи проект Stars и получи виртуальные TON для торговли. Они существуют только внутри MXM и не являются настоящим TON.</p></header>
    <div className="divide-y divide-[var(--border-soft)] border-y border-[var(--border-soft)]">{STAR_PACKAGES.map((pack) => <button key={pack.stars} disabled={busy !== null} onClick={() => void buy(pack.stars)} className="group flex w-full items-center gap-3 py-4 text-left disabled:opacity-50"><div className="min-w-0 flex-1"><p className="text-[12px] font-semibold">{pack.label}</p><p className="mt-1 flex items-center gap-1 text-[10px] text-[var(--muted)]"><Gem size={11} fill="currentColor" className="text-[var(--accent)]"/>{pack.virtualTon.toLocaleString("ru-RU")} виртуальных TON</p></div><span className="inline-flex items-center gap-1 text-[12px] font-semibold"><Star size={13} fill="currentColor" className="text-[#f5c451]"/>{busy === pack.stars ? "…" : pack.stars}</span></button>)}</div>
    {notice ? <p className="mt-4 text-[11px] text-[var(--muted)]">{notice}</p> : null}
  </div>;
}
