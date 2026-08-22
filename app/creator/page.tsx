"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarChart3, BadgeCheck, Coins, Rocket, TrendingUp, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { compact, money, price } from "@/lib/format";
import { rankLabel } from "@/lib/ui-copy";

type CreatorCoin = {
  id:string; name:string; symbol:string; imageUrl:string|null; status:string; currentPrice:number; marketCap:number;
  floorPrice:number|null; floorActive:boolean; holders:number; volume:number; creatorFees:number; boostedUntil:string|null; createdAt:string;
  uniqueBuyers?:number|null; buyerRetentionPct?:number|null; buySellRatio?:number|null;
};
type Payload = {
  verified:boolean; analyticsUnlocked:boolean;
  level:{ name:string; creatorFeeBps:number; platformFeeBps:number; holderCount:number; volume:number; nextVolume:number|null };
  totals:{ coins:number; holders:number; volume:number; creatorFees:number };
  entitlements:Array<{key:string;expiresAt:string|null}>; coins:CreatorCoin[];
};

export default function CreatorDashboardPage() {
  const [data,setData]=useState<Payload|null>(null);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{ void apiFetch<Payload>("/api/creator",{cacheMs:0}).then(setData).catch((cause)=>setError(cause instanceof Error?cause.message:"Не удалось загрузить кабинет")); },[]);
  if (error) return <div className="mxm-alert mxm-alert-error">{error}</div>;
  if (!data) return <div className="mxm-skeleton h-48" />;
  return <div className="mx-auto max-w-5xl">
    <header className="mb-4 flex items-end justify-between gap-3 border-b border-[var(--border-soft)] pb-4">
      <div><div className="flex items-center gap-2"><h1 className="text-xl font-semibold">Центр автора</h1>{data.verified?<BadgeCheck size={17} className="text-[#63a7ff]" aria-label="Проверенный автор"/>:null}</div><p className="mt-1 text-[10px] text-[var(--muted)]">Комиссии — только внутренняя виртуальная валюта без вывода.</p></div>
      <Link href="/create" className="mxm-quick-link"><Rocket size={13}/>Запустить мемкоин</Link>
    </header>
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Metric icon={<TrendingUp size={13}/>} label="Уровень" value={rankLabel(data.level.name)}/>
      <Metric icon={<Coins size={13}/>} label="Доля комиссии" value={`${data.level.creatorFeeBps/100}%`}/>
      <Metric icon={<Users size={13}/>} label="Владельцы" value={compact(data.totals.holders)}/>
      <Metric icon={<BarChart3 size={13}/>} label="Заработано" value={money(data.totals.creatorFees)}/>
    </section>
    {!data.analyticsUnlocked?<div className="mxm-card mt-3 p-3 text-[10px] text-[var(--muted)]">Расширенные метрики покупателей доступны с расширенной аналитикой в магазине MXM.</div>:null}
    <section className="mt-4 overflow-hidden rounded-[16px] border border-[var(--border)]">
      <div className="mxm-section-head"><span>Мои мемкоины</span><span>{data.coins.length}</span></div>
      {data.coins.length?<div className="divide-y divide-[var(--border-soft)]">{data.coins.map((coin)=><Link href={`/coin/${coin.id}`} key={coin.id} className="block p-3 hover:bg-white/[.025]">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold">{coin.name} <span className="text-[var(--muted)]">${coin.symbol}</span></p><p className="mt-1 text-[9px] text-[var(--muted)]">{coin.holders} владельцев · объём {money(coin.volume)} · комиссия {money(coin.creatorFees)}</p></div><div className="text-right"><p className="text-xs">{price(coin.currentPrice)}</p><p className="mt-1 text-[9px] text-[var(--muted)]">Капитализация {money(coin.marketCap)}</p></div></div>
        {data.analyticsUnlocked?<p className="mt-2 text-[9px] text-[var(--muted-2)]">Уникальные покупатели: {coin.uniqueBuyers??0} · удержание: {coin.buyerRetentionPct??0}% · покупки/продажи: {coin.buySellRatio??0}</p>:null}
      </Link>)}</div>:<p className="p-8 text-center text-xs text-[var(--muted)]">Вы ещё не запускали мемкоины.</p>}
    </section>
  </div>;
}

function Metric({icon,label,value}:{icon:React.ReactNode;label:string;value:string}) { return <div className="mxm-card p-3"><div className="flex items-center gap-1.5 text-[9px] text-[var(--muted)]">{icon}{label}</div><p className="mt-2 text-sm font-semibold">{value}</p></div>; }
