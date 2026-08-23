"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, CheckCheck, Gift, Megaphone, Settings2, TrendingUp, UsersRound } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ago } from "@/lib/format";
import type { NotificationPreferenceKey, NotificationPreferences } from "@/lib/notifications";

type Notification = { id: string; kind: string; title: string; body: string; href: string | null; readAt: string | null; createdAt: string };
type Payload = { notifications: Notification[]; preferences: NotificationPreferences; unreadCount: number };

export default function NotificationsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [settings, setSettings] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preferencesRef = useRef<NotificationPreferences | null>(null);
  const load = useCallback(() => apiFetch<Payload>("/api/notifications").then((payload) => {
    preferencesRef.current = payload.preferences;
    setData(payload);
    setError(null);
  }).catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить уведомления")), []);
  useEffect(() => { void load(); }, [load]);
  async function read(id: string) {
    if (!data || busy === id) return;
    setBusy(id);
    const previous = data;
    const now = new Date().toISOString();
    setData({ ...data, notifications: data.notifications.map((item) => item.id === id && !item.readAt ? { ...item, readAt: now } : item), unreadCount: Math.max(0, data.unreadCount - (data.notifications.some((item) => item.id === id && !item.readAt) ? 1 : 0)) });
    try { await apiFetch("/api/notifications", { method: "POST", body: JSON.stringify({ action: "read", id }) }); setError(null); }
    catch (cause) { setData(previous); setError(cause instanceof Error ? cause.message : "Не удалось отметить уведомление"); }
    finally { setBusy(null); }
  }
  async function readAll() {
    if (!data || busy) return;
    setBusy("all");
    const previous = data;
    const now = new Date().toISOString();
    setData({ ...data, notifications: data.notifications.map((item) => item.readAt ? item : { ...item, readAt: now }), unreadCount: 0 });
    try { await apiFetch("/api/notifications", { method: "POST", body: JSON.stringify({ action: "read_all" }) }); setError(null); }
    catch (cause) { setData(previous); setError(cause instanceof Error ? cause.message : "Не удалось отметить уведомления"); }
    finally { setBusy(null); }
  }
  async function toggle(key: NotificationPreferenceKey) {
    const previous = preferencesRef.current;
    if (!previous || busy === `pref:${key}`) return;
    setBusy(`pref:${key}`);
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
    } finally {
      setBusy(null);
    }
  }
  const visible = useMemo(() => data?.notifications.filter((item) => filter === "all" || !item.readAt) || [], [data?.notifications, filter]);
  const groups = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const keyOf = (value: string) => new Date(value).toDateString();
    const labels = new Map([[today.toDateString(), "Сегодня"], [yesterday.toDateString(), "Вчера"]]);
    const result: Array<{ key: string; label: string; items: Notification[] }> = [];
    for (const item of visible) {
      const key = keyOf(item.createdAt);
      let group = result.find((entry) => entry.key === key);
      if (!group) {
        group = { key, label: labels.get(key) || new Date(item.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }), items: [] };
        result.push(group);
      }
      group.items.push(item);
    }
    return result;
  }, [visible]);

  if (!data) return <div className="mx-auto max-w-3xl"><div className="mxm-skeleton h-24 rounded-[22px]" /><div className="mxm-skeleton mt-3 h-80 rounded-[22px]" />{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}</div>;
  return <div className="mx-auto max-w-3xl">
    <section className="mxm-summary-card p-3.5">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-[14px] bg-[var(--panel-2)] text-[var(--accent)]"><Bell size={16} /></span>
        <div className="min-w-0 flex-1"><h1 className="text-sm font-semibold">Уведомления</h1><p className="text-[9px] text-[var(--muted)]">{data.unreadCount ? `${data.unreadCount} непрочитанных` : "Всё прочитано"}</p></div>
        {data.unreadCount ? <button disabled={Boolean(busy)} onClick={() => void readAll()} className="mxm-secondary-action !min-h-8 !px-2.5"><CheckCheck size={12} />{busy === "all" ? "…" : "Все"}</button> : null}
        <button aria-expanded={settings} aria-label="Настройки уведомлений" onClick={() => setSettings((v) => !v)} className="grid h-8 w-8 place-items-center rounded-[11px] bg-[var(--panel-2)] text-[var(--muted)]"><Settings2 size={14} /></button>
      </div>
      <div className="mt-3 flex gap-1 border-t border-[var(--border-soft)] pt-2">
        <button type="button" onClick={() => setFilter("all")} className={`mxm-notification-filter ${filter === "all" ? "is-active" : ""}`}>Все · {data.notifications.length}</button>
        <button type="button" onClick={() => setFilter("unread")} className={`mxm-notification-filter ${filter === "unread" ? "is-active" : ""}`}>Непрочитанные · {data.unreadCount}</button>
        <button type="button" onClick={() => void load()} className="ml-auto mxm-notification-filter">Обновить</button>
      </div>
    </section>

    {error ? <div className="mxm-alert mxm-alert-error mt-3 flex items-center justify-between gap-2"><span>{error}</span><button type="button" onClick={() => void load()} className="underline">Повторить</button></div> : null}

    {settings ? <section className="mxm-card mt-3 p-3"><p className="mb-2 text-xs font-medium">Настройки</p><div className="space-y-0.5">{([['gift_sold','Продажи подарков'],['gift_offer','Новые предложения'],['offer_resolved','Решение по предложению'],['price_alert','Ценовые уведомления'],['coin_move','Движение мемкоинов'],['referral_reward','Доход от рефералов'],['promo','Промокоды'],['telegram_push','Уведомления в Telegram']] as [NotificationPreferenceKey,string][]).map(([key,label]) => <button key={key} role="switch" aria-checked={data.preferences[key]} disabled={busy === `pref:${key}`} onClick={() => void toggle(key)} className="flex w-full items-center justify-between rounded-[12px] px-2.5 py-2 text-left text-[10px] hover:bg-[var(--panel-2)] disabled:opacity-60"><span>{label}</span><span aria-hidden="true" className={`mxm-switch ${data.preferences[key] ? 'is-on' : ''}`}><span /></span></button>)}</div></section> : null}

    <section className="mt-3 overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--panel)]">{visible.length ? <div>{groups.map((group) => <div key={group.key}><div className="mxm-notification-day">{group.label}</div><div className="divide-y divide-[var(--border-soft)]">{group.items.map((n) => {
      const inner = <div className={`mxm-row-interactive flex gap-3 p-3 ${n.readAt ? '' : 'bg-white/[.025]'}`}><span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[13px] bg-[var(--panel-2)]">{iconFor(n.kind)}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-[11px] font-medium">{n.title}</p>{!n.readAt ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" /> : null}</div>{n.body ? <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-[var(--muted)]">{n.body}</p> : null}<p className="mt-1 text-[8px] text-[var(--muted-2)]">{ago(n.createdAt)}{busy === n.id ? " · сохраняем…" : ""}</p></div></div>;
      return n.href ? <Link key={n.id} href={n.href} onClick={() => { if (!n.readAt) void read(n.id); }}>{inner}</Link> : <button key={n.id} disabled={busy === n.id} onClick={() => { if (!n.readAt) void read(n.id); }} className="w-full text-left disabled:opacity-70">{inner}</button>;
    })}</div></div>)}</div> : <div className="p-9 text-center"><Bell size={21} className="mx-auto text-[var(--muted-2)]" /><p className="mt-3 text-xs font-medium">{filter === "unread" ? "Непрочитанных нет" : "Уведомлений пока нет"}</p></div>}</section>
  </div>;
}

function iconFor(kind: string) { if (kind.includes('gift') || kind.includes('offer')) return <Gift size={13} />; if (kind.includes('referral')) return <UsersRound size={13} />; if (kind.includes('coin') || kind.includes('price')) return <TrendingUp size={13} />; if (kind.includes('promo')) return <Megaphone size={13} />; return <Bell size={13} />; }
