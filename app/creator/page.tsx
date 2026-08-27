"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, BadgeCheck, Coins, RefreshCw, Rocket, ShieldCheck, ShoppingBag, Sparkles, TrendingUp, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { compact, money, price } from "@/lib/format";
import { rankLabel } from "@/lib/ui-copy";

type CreatorCoin = {
  id:string; name:string; symbol:string; imageUrl:string|null; status:string; currentPrice:number; marketCap:number;
  floorPrice:number|null; floorActive:boolean; holders:number; volume:number; creatorFees:number; boostedUntil:string|null; createdAt:string;
  uniqueBuyers?:number|null; buyerRetentionPct?:number|null; buySellRatio?:number|null;
};
type Reputation = {
  score:number; grade:string; coinCount:number; activeCoins:number; externalHolders:number; uniqueTraders:number;
  externalVolume:number; marketAgeDays:number; verified:boolean; verificationTier:string|null; antiWash:boolean;
};
type Payload = {
  verified:boolean; analyticsUnlocked:boolean;
  level:{
    name:string; creatorFeeBps:number; platformFeeBps:number; holderCount:number; traderCount:number; volume:number;
    nextVolume:number|null; nextHolders:number|null; nextTraders:number|null; antiWash:boolean;
  };
  reputation:Reputation;
  totals:{ coins:number; holders:number; volume:number; creatorFees:number };
  entitlements:Array<{key:string;expiresAt:string|null}>; coins:CreatorCoin[];
};

function entitlementLabel(key:string) {
  const labels:Record<string,string>={
    creator_analytics:"Расширенная аналитика",
    creator_boost:"Продвижение автора",
    creator_verified:"Верификация",
  };
  return labels[key] || key.replaceAll("_", " ");
}

function reputationLabel(grade:string) {
  const labels:Record<string,string>={ Starter:"Новичок",Builder:"Создатель",Proven:"Проверенный рынком",Trusted:"Надёжный",Elite:"Элита" };
  return labels[grade] || grade;
}

function progress(current:number,target:number|null) {
  if(target==null) return 1;
  if(!Number.isFinite(target)||target<=0) return 0;
  return Math.min(1,Math.max(0,current/target));
}

export default function CreatorDashboardPage() {
  const [data,setData]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const load=useCallback(async()=>{
    setLoading(true);setError(null);
    try{setData(await apiFetch<Payload>("/api/creator",{cacheMs:0}));}
    catch(cause){setError(cause instanceof Error?cause.message:"Не удалось загрузить кабинет");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);

  const levelAxes=useMemo(()=>data ? [
    {key:"volume",label:"Объём от других игроков",current:data.level.volume,target:data.level.nextVolume,display:money(data.level.volume)},
    {key:"holders",label:"Внешние владельцы",current:data.level.holderCount,target:data.level.nextHolders,display:compact(data.level.holderCount)},
    {key:"traders",label:"Уникальные трейдеры",current:data.level.traderCount,target:data.level.nextTraders,display:compact(data.level.traderCount)},
  ] : [],[data]);

  if (!data && loading) return <div className="mx-auto max-w-5xl"><div className="mxm-skeleton h-36 rounded-[18px]"/><div className="mxm-skeleton mt-3 h-56 rounded-[18px]"/></div>;
  if (!data) return <div className="mxm-card mx-auto max-w-xl p-6 text-center"><p className="text-xs text-[var(--negative)]">{error||"Кабинет недоступен"}</p><button type="button" onClick={()=>void load()} className="mxm-secondary-action mt-4"><RefreshCw size={12}/>Повторить</button></div>;

  const maxLevel=data.level.nextVolume==null&&data.level.nextHolders==null&&data.level.nextTraders==null;
  return <div className="mx-auto max-w-5xl">
    <header className="mxm-compact-page-head">
      <div className="min-w-0"><div className="flex items-center gap-2"><h1 className="mxm-page-title">Центр автора</h1>{data.verified?<BadgeCheck size={16} className="text-[#63a7ff]" aria-label="Проверенный автор"/>:null}</div><p className="mt-1 text-[9px] text-[var(--muted)]">Уровень растёт только от реальной аудитории и рынка.</p></div>
      <div className="flex shrink-0 gap-2"><Link href="/store?category=creator" className="mxm-compact-link"><ShoppingBag size={12}/>Инструменты</Link><Link href="/create" className="mxm-compact-link"><Rocket size={12}/>Запустить</Link></div>
    </header>

    {error?<div className="mxm-alert mxm-alert-error mb-3 flex items-center justify-between gap-2"><span>{error}</span><button type="button" onClick={()=>void load()} className="underline">Обновить</button></div>:null}

    <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Metric icon={<TrendingUp size={12}/>} label="Уровень" value={rankLabel(data.level.name)}/>
      <Metric icon={<ShieldCheck size={12}/>} label="Репутация" value={`${data.reputation.score}/100`}/>
      <Metric icon={<Activity size={12}/>} label="Трейдеры" value={compact(data.reputation.uniqueTraders)}/>
      <Metric icon={<BarChart3 size={12}/>} label="Заработано" value={money(data.totals.creatorFees)}/>
    </section>

    <section className="mt-3 rounded-[16px] border border-[var(--border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[11px] font-semibold">Репутация · {reputationLabel(data.reputation.grade)}</p><p className="mt-1 text-[8px] leading-4 text-[var(--muted)]">Считаются внешние владельцы, уникальные трейдеры, возраст рынков и реальный объём. Самоторговля не прокачивает уровень.</p></div>
        <strong className="shrink-0 text-[16px] tabular-nums">{data.reputation.score}</strong>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.055]"><div className="h-full rounded-full bg-[var(--accent)]" style={{width:`${data.reputation.score}%`}}/></div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <MiniMetric label="Внешние холдеры" value={compact(data.reputation.externalHolders)}/>
        <MiniMetric label="Уник. трейдеры" value={compact(data.reputation.uniqueTraders)}/>
        <MiniMetric label="Возраст рынка" value={`${Math.floor(data.reputation.marketAgeDays)}д`}/>
      </div>
    </section>

    <section className="mt-3 border-y border-[var(--border-soft)] py-3">
      <div className="mb-2 flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold">Рост уровня</p><p className="mt-0.5 text-[8px] text-[var(--muted)]">Нужно выполнить все три условия, а не одно.</p></div><span className="text-[9px] text-[var(--muted)]">{maxLevel?"максимальный уровень":`${data.level.creatorFeeBps/100}% автору`}</span></div>
      <div className="space-y-2.5">{levelAxes.map((axis)=>{
        const pct=progress(axis.current,axis.target);
        const done=axis.target==null||axis.current>=axis.target;
        return <div key={axis.key}>
          <div className="flex items-center justify-between gap-3 text-[8px]"><span className="text-[var(--muted)]">{axis.label}</span><span className={done?"text-[var(--positive)]":"text-white"}>{axis.display}{axis.target!=null?` / ${axis.key==="volume"?money(axis.target):compact(axis.target)}`:" · готово"}</span></div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[.055]"><div className="h-full rounded-full bg-[var(--accent)]" style={{width:`${Math.round(pct*100)}%`}}/></div>
        </div>;
      })}</div>
    </section>

    <section className="mt-3">
      <div className="mxm-compact-section-head"><span>Активные инструменты</span><span>{data.entitlements.length}</span></div>
      {data.entitlements.length?<div className="flex flex-wrap gap-1.5">{data.entitlements.map((item)=><span key={item.key} className="mxm-creator-entitlement"><Sparkles size={10}/><span>{entitlementLabel(item.key)}</span><small>{item.expiresAt?`до ${new Date(item.expiresAt).toLocaleDateString("ru-RU")}`:"без срока"}</small></span>)}</div>:<Link href="/store?category=creator" className="text-[9px] text-[var(--accent)]">Выбрать инструменты</Link>}
    </section>

    {!data.analyticsUnlocked?<div className="mxm-card mt-3 flex items-center justify-between gap-3 p-3 text-[9px] text-[var(--muted)]"><span>Расширенная аналитика</span><Link href="/store?category=creator" className="shrink-0 text-[var(--accent)]">Открыть</Link></div>:null}

    <section className="mt-4 overflow-hidden rounded-[16px] border border-[var(--border)]">
      <div className="mxm-section-head"><span>Мои мемкоины</span><span>{data.coins.length}</span></div>
      {data.coins.length?<div className="divide-y divide-[var(--border-soft)]">{data.coins.map((coin)=>{
        const hasMarketActivity=Number(coin.volume)>0 || Number(coin.uniqueBuyers||0)>0;
        const boostActive=Boolean(coin.boostedUntil&&new Date(coin.boostedUntil).getTime()>Date.now());
        return <Link href={`/coin/${coin.id}`} key={coin.id} className="block p-3 hover:bg-white/[.025]">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-[11px] font-semibold">{coin.name} <span className="text-[var(--muted)]">${coin.symbol}</span></p><div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[8px] text-[var(--muted)]"><span>{coin.holders} владельцев</span>{hasMarketActivity?<span>объём {money(coin.volume)}</span>:<span className="text-[var(--accent)]">Новый рынок</span>}<span>комиссия {money(coin.creatorFees)}</span>{boostActive?<span className="text-[var(--accent)]">продвижение активно</span>:null}</div></div><div className="shrink-0 text-right"><p className="text-[11px]">{price(coin.currentPrice)}</p><p className="mt-1 text-[8px] text-[var(--muted)]">кап. {money(coin.marketCap)}</p></div></div>
          {data.analyticsUnlocked&&hasMarketActivity?<div className="mt-2 flex flex-wrap gap-1.5">{[["Покупатели",coin.uniqueBuyers??0],["Удержание",`${coin.buyerRetentionPct??0}%`],["Buy/Sell",coin.buySellRatio??0]].map(([label,value])=><span key={String(label)} className="mxm-creator-metric-pill"><small>{label}</small><b>{value}</b></span>)}</div>:null}
        </Link>;
      })}</div>:<div className="p-8 text-center"><p className="text-xs text-[var(--muted)]">Вы ещё не запускали мемкоины.</p><Link href="/create" className="mt-3 inline-flex text-[9px] text-[var(--accent)]">Запустить первый</Link></div>}
    </section>
  </div>;
}

function MiniMetric({label,value}:{label:string;value:string}) { return <div className="rounded-[12px] bg-white/[.025] px-2 py-2"><p className="text-[7px] text-[var(--muted)]">{label}</p><p className="mt-1 text-[10px] font-semibold">{value}</p></div>; }
function Metric({icon,label,value}:{icon:React.ReactNode;label:string;value:string}) { return <div className="mxm-card p-3"><div className="flex items-center gap-1.5 text-[8px] text-[var(--muted)]">{icon}{label}</div><p className="mt-1.5 text-[13px] font-semibold">{value}</p></div>; }
