"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, Gift, Megaphone, Settings2, TrendingUp, UsersRound } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ago } from "@/lib/format";
import type { NotificationPreferenceKey, NotificationPreferences } from "@/lib/notifications";

type Notification = { id: string; kind: string; title: string; body: string; href: string | null; readAt: string | null; createdAt: string };
type Payload = { notifications: Notification[]; preferences: NotificationPreferences; unreadCount: number };

export default function NotificationsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preferencesRef = useRef<NotificationPreferences | null>(null);
  const load = useCallback(() => apiFetch<Payload>("/api/notifications").then((payload) => {
    preferencesRef.current = payload.preferences;
    setData(payload);
    setError(null);
  }).catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить уведомления")), []);
  useEffect(() => { void load(); }, [load]);
  async function read(id: string) {
    if (!data) return;
    const previous = data;
    const now = new Date().toISOString();
    setData({ ...data, notifications: data.notifications.map((item) => item.id === id && !item.readAt ? { ...item, readAt: now } : item), unreadCount: Math.max(0, data.unreadCount - (data.notifications.some((item) => item.id === id && !item.readAt) ? 1 : 0)) });
    try { await apiFetch("/api/notifications", { method: "POST", body: JSON.stringify({ action: "read", id }) }); setError(null); }
    catch (cause) { setData(previous); setError(cause instanceof Error ? cause.message : "Не удалось отметить уведомление"); }
  }
  async function readAll() {
    if (!data) return;
    const previous = data;
    const now = new Date().toISOString();
    setData({ ...data, notifications: data.notifications.map((item) => item.readAt ? item : { ...item, readAt: now }), unreadCount: 0 });
    try { await apiFetch("/api/notifications", { method: "POST", body: JSON.stringify({ action: "read_all" }) }); setError(null); }
    catch (cause) { setData(previous); setError(cause instanceof Error ? cause.message : "Не удалось отметить уведомления"); }
  }
  async function toggle(key: NotificationPreferenceKey) {
    const previous = preferencesRef.current;
    if (!previous) return;
    const previousValue = previous[key];
    const nextValue = !previousValue;
    const next = { ...previous, [key]: nextValue };
    preferencesRef.current = next;
    setData((current) => current ? { ...current, preferences: next } : current);
    try {
      await apiFetch("/api/notifications", { method: "POST", body: JSON.stringify({ action: "preferences", [key]: nextValue }) });
      setError(null);
    } catch (cause) {
      setData((current) => {
        if (!current || current.preferences[key] !== nextValue) return current;
        const reverted = { ...current.preferences, [key]: previousValue };
        preferencesRef.current = reverted;
        return { ...current, preferences: reverted };
      });
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить настройки");
    }
  }
  if (!data) return <div className="mx-auto max-w-3xl"><div className="mxm-skeleton h-24 rounded-[22px]" /><div className="mxm-skeleton mt-3 h-80 rounded-[22px]" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  return <div className="mx-auto max-w-3xl">
    <section className="mxm-summary-card p-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-[16px] bg-[var(--panel-2)] text-[var(--accent)]"><Bell size={17} /></span><div className="min-w-0 flex-1"><h1 className="text-base font-semibold">Уведомления</h1><p className="text-[10px] text-[var(--muted)]">{data.unreadCount ? `${data.unreadCount} непрочитанных` : "Всё прочитано"}</p></div>{data.unreadCount ? <button onClick={() => void readAll()} className="flex items-center gap-1.5 rounded-[14px] bg-[var(--panel-2)] px-3 py-2 text-[10px]"><CheckCheck size={13} />Прочитать все</button> : null}<button onClick={() => setSettings((v) => !v)} className="grid h-8 w-8 place-items-center rounded-[13px] bg-[var(--panel-2)]"><Settings2 size={14} /></button></div></section>

    {settings ? <section className="mxm-card mt-3 p-3"><p className="mb-2 text-xs font-medium">Какие события показывать</p><div className="space-y-1">{([['gift_sold','Продажи подарков'],['gift_offer','Новые предложения'],['offer_resolved','Решение по предложению'],['price_alert','Ценовые уведомления'],['coin_move','Движение мемкоинов'],['referral_reward','Доход от рефералов'],['promo','Промокоды'],['telegram_push','Уведомления в Telegram']] as [NotificationPreferenceKey,string][]).map(([key,label]) => <button key={key} onClick={() => void toggle(key)} className="flex w-full items-center justify-between rounded-[14px] px-2.5 py-2 text-left text-[11px] hover:bg-[var(--panel-2)]"><span>{label}</span><span className={`h-5 w-9 rounded-full p-0.5 transition ${data.preferences[key] ? 'bg-[var(--accent)]' : 'bg-[var(--panel-3)]'}`}><span className={`block h-4 w-4 rounded-full bg-white transition ${data.preferences[key] ? 'translate-x-4' : ''}`} /></span></button>)}</div></section> : null}

    <section className="mt-3 overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)]">{data.notifications.length ? <div className="divide-y divide-[var(--border-soft)]">{data.notifications.map((n) => { const inner = <div className={`flex gap-3 p-3 ${n.readAt ? '' : 'bg-white/[.025]'}`}><span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[14px] bg-[var(--panel-2)]">{iconFor(n.kind)}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-xs font-medium">{n.title}</p>{!n.readAt ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" /> : null}</div>{n.body ? <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">{n.body}</p> : null}<p className="mt-1 text-[9px] text-[var(--muted-2)]">{ago(n.createdAt)}</p></div></div>; return n.href ? <Link key={n.id} href={n.href} onClick={() => { if (!n.readAt) void read(n.id); }}>{inner}</Link> : <button key={n.id} onClick={() => { if (!n.readAt) void read(n.id); }} className="w-full text-left">{inner}</button>; })}</div> : <div className="p-10 text-center"><Bell size={22} className="mx-auto text-[var(--muted-2)]" /><p className="mt-3 text-xs font-medium">Уведомлений пока нет</p></div>}</section>
  </div>;
}

function iconFor(kind: string) { if (kind.includes('gift') || kind.includes('offer')) return <Gift size={13} />; if (kind.includes('referral')) return <UsersRound size={13} />; if (kind.includes('coin') || kind.includes('price')) return <TrendingUp size={13} />; if (kind.includes('promo')) return <Megaphone size={13} />; return <Bell size={13} />; }
