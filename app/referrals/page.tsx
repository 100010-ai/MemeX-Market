"use client";

import { useEffect, useState } from "react";
import { Copy, Gem, Share2, UsersRound } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money, ago } from "@/lib/format";
import { useTelegramProfile } from "@/components/telegram-provider";

type Payload = {
  code: string;
  inviteLink: string | null;
  percent: number;
  invitedCount: number;
  totalEarned: number;
  referred: Array<{ id: string; name: string; photoUrl: string | null; joinedAt: string }>;
  rewards: Array<{ id: string; rewardAmount: number; sourceAmount: number; sourceKind: string; createdAt: string; referred: { username?: string | null; first_name?: string | null } | null }>;
};

export default function ReferralsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { haptic } = useTelegramProfile();
  useEffect(() => { apiFetch<Payload>("/api/referrals", { cacheMs: 3_000 }).then(setData).catch((e) => setNotice(e instanceof Error ? e.message : "Не удалось загрузить рефералку")); }, []);

  async function copy() {
    if (!data?.inviteLink) return;
    await navigator.clipboard.writeText(data.inviteLink);
    setNotice("Ссылка скопирована"); haptic("light");
  }
  function share() {
    if (!data?.inviteLink) return;
    const url = `https://t.me/share/url?url=${encodeURIComponent(data.inviteLink)}&text=${encodeURIComponent(`Залетай в MXM — виртуальный рынок Telegram Gifts и мемкоинов.`)}`;
    if (window.Telegram?.WebApp?.openTelegramLink) window.Telegram.WebApp.openTelegramLink(url);
    else window.open(url, "_blank");
  }

  return <div className="mx-auto max-w-3xl">
    <header className="mb-5 border-b border-[var(--border-soft)] pb-4"><p className="text-[10px] uppercase tracking-[.14em] text-[var(--muted-2)]">Партнёрка</p><h1 className="mt-1 text-[20px] font-semibold tracking-[-.035em]">Приглашай друзей</h1><p className="mt-1.5 max-w-xl text-[11px] leading-5 text-[var(--muted)]">Получай {data?.percent ?? 5}% внутриигровым бонусом от системных наград приглашённых: заданий, рекламы и покупок Stars. Бонус существует только внутри MXM, не выводится и не является реальным TON. Торговый оборот не учитывается, чтобы рефералку нельзя было фармить круговыми сделками.</p></header>
    <div className="grid grid-cols-2 gap-x-6 border-b border-[var(--border-soft)] pb-4"><Metric label="Приглашено" value={String(data?.invitedCount ?? 0)} /><Metric label="Получено бонусов" value={money(data?.totalEarned ?? 0)} /></div>
    <section className="py-5 border-b border-[var(--border-soft)]"><div className="flex items-center gap-3"><div className="min-w-0 flex-1"><p className="text-[10px] text-[var(--muted)]">Твоя ссылка</p><p className="mt-1 truncate text-[12px] font-medium">{data?.inviteLink || "Загружаем…"}</p></div><button onClick={copy} className="mxm-icon-action" aria-label="Копировать"><Copy size={16}/></button><button onClick={share} className="mxm-icon-action" aria-label="Поделиться"><Share2 size={16}/></button></div>{notice ? <p className="mt-2 text-[10px] text-[var(--accent)]">{notice}</p> : null}</section>
    <section className="py-5"><div className="mb-2 flex items-center gap-2 text-[12px] font-medium"><UsersRound size={15}/>Последние приглашённые</div>{data?.referred.length ? <div className="divide-y divide-[var(--border-soft)]">{data.referred.map((person) => <div key={person.id} className="flex items-center gap-3 py-3">{person.photoUrl ? <img src={person.photoUrl} alt="" className="h-9 w-9 rounded-full object-cover"/> : <div className="grid h-9 w-9 place-items-center rounded-full bg-white/[.04]"><UsersRound size={14}/></div>}<div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium">{person.name}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">в MXM {ago(person.joinedAt)}</p></div></div>)}</div> : <p className="py-8 text-center text-[11px] text-[var(--muted)]">Пока никого. Скинь ссылку другу.</p>}</section>
  </div>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><p className="text-[9px] text-[var(--muted)]">{label}</p><p className="mt-1 flex items-center gap-1 text-[16px] font-semibold"><Gem size={12} fill="currentColor" className="text-[var(--accent)]"/>{value}</p></div>; }
