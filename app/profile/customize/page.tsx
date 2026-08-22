"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, Crown, Palette, ShieldCheck, Sparkles, Star } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useTelegramProfile } from "@/components/telegram-provider";
import { ProfileAvatar } from "@/components/profile-avatar";
import { itemTypeLabel, rankLabel } from "@/lib/ui-copy";

type Item = { key: string; type: string; title: string; equipped: boolean };
type Payload = { wallet: { vipTier?: string; vipProgress?: number; premiumActive?: boolean }; items: Item[] };

export default function CustomizeProfilePage() {
  const { profile, haptic } = useTelegramProfile();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => setData(await apiFetch<Payload>("/api/profile/customize", { cacheMs: 0 })), []);
  useEffect(() => {
    let cancelled = false;
    void apiFetch<Payload>("/api/profile/customize", { cacheMs: 0 })
      .then((result) => { if (!cancelled) setData(result); })
      .catch((cause) => { if (!cancelled) setNotice(cause instanceof Error ? cause.message : "Не удалось загрузить оформление"); });
    return () => { cancelled = true; };
  }, []);

  async function equip(key: string) {
    if (busy) return;
    setBusy(key); setNotice(null);
    try { await apiFetch("/api/profile/customize", { method: "POST", body: JSON.stringify({ key }) }); haptic("medium"); await load(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "Не удалось применить предмет"); }
    finally { setBusy(null); }
  }

  async function unequip() {
    if (busy) return;
    setBusy("reset"); setNotice(null);
    try { await apiFetch("/api/profile/customize", { method: "POST", body: JSON.stringify({ action: "reset", key: null }) }); haptic("light"); await load(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "Не удалось снять рамку"); }
    finally { setBusy(null); }
  }

  const equippedFrame = data?.items.find((item) => item.equipped && item.type === "frame") || null;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4 border-b border-[var(--border-soft)] pb-4">
        <p className="text-[10px] uppercase tracking-[.14em] text-[var(--muted-2)]">Внешний вид</p>
        <h1 className="mt-1 text-[20px] font-semibold tracking-[-.035em]">Оформление профиля</h1>
        <p className="mt-1.5 text-[10px] leading-5 text-[var(--muted)]">Рамки профиля и коллекционные значки — только косметика. Они не меняют цену активов и торговые шансы.</p>
      </header>
      {notice ? <div className="mxm-alert mb-3">{notice}</div> : null}
      <section className="mxm-card mb-3 p-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <ProfileAvatar photoUrl={profile?.photoUrl || null} name={profile?.firstName || "Пользователь MXM"} equippedFrame={equippedFrame?.key || null} size="large" />
            {data?.wallet.premiumActive ? <Crown size={15} className="absolute -right-1 -top-1 text-[#f5c451]" fill="currentColor" /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{profile?.username ? `@${profile.username}` : profile?.firstName || "Пользователь MXM"}</p>
            <p className="mt-1 flex items-center gap-1 text-[9px] text-[var(--muted)]"><ShieldCheck size={10} />Уровень: {rankLabel(data?.wallet.vipTier)}</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(Number(data?.wallet.vipProgress || 0))}%` }} /></div>
          </div>
        </div>
      </section>
      <div className="grid gap-2 sm:grid-cols-2">
        {data?.items.length ? data.items.map((item) => (
          <article key={item.key} className="mxm-card flex items-center gap-3 p-3">
            <div className="grid h-10 w-10 place-items-center rounded-[13px] bg-white/[.045] text-[var(--accent)]">{item.type === "frame" ? <Sparkles size={16} /> : item.type === "title" ? <Star size={16} /> : <Palette size={16} />}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium">{item.title}</p><p className="mt-1 text-[8px] uppercase text-[var(--muted)]">{itemTypeLabel(item.type)}</p></div>
            {item.equipped ? <button type="button" disabled={Boolean(busy)} onClick={() => void unequip()} className="inline-flex items-center gap-1 text-[9px] text-[var(--positive)]"><Check size={11} />{busy === "reset" ? "…" : "Снять"}</button> : item.type === "frame" ? <button type="button" disabled={Boolean(busy)} onClick={() => void equip(item.key)} className="text-[9px] text-[var(--accent)]">{busy === item.key ? "…" : "Выбрать"}</button> : <span className="text-[9px] text-[var(--muted)]">Получено</span>}
          </article>
        )) : (
          <div className="mxm-card col-span-full p-8 text-center"><Palette size={23} className="mx-auto text-[var(--muted)]" /><p className="mt-3 text-[11px]">Предметов оформления пока нет</p><Link href="/store?category=profile" className="mt-3 inline-block text-[10px] text-[var(--accent)]">Открыть магазин MXM</Link></div>
        )}
      </div>
    </div>
  );
}
