"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Ban, BarChart3, Boxes, CheckCircle2, ChevronDown, ChevronUp, Copy,
  Gauge, Layers3, RefreshCw, RotateCcw, ShieldAlert, ShieldCheck, Star, ToggleLeft,
  ToggleRight, Users, WalletCards,
} from "lucide-react";

type Profile = { id:string; telegram_id:number; username:string|null; first_name:string; is_banned:boolean; hidden_from_leaderboard:boolean; balance:number|string; mxm_coins:number|string; stars_spent:number|string; vip_points:number|string };
type StarPurchase = { id:string; stars:number; status:string; product_sku:string|null; paid_at:string|null; created_at:string; refunded_at:string|null; refund_reason:string|null; profile:Profile|null };
type Loot = { id:string; reward_kind:string; reward_label:string; amount:number; weight:number; rarity:string; active:boolean; chance:number };
type CaseRow = { sku:string; title:string; tier:string; remaining_supply:number; active:boolean; rare_pity:number; epic_pity:number; legendary_pity:number; activeWeight:number; loot:Loot[] };
type Reward = { level:number; track:string; required_xp:number; reward_kind:string; reward_label:string; amount:number };
type Season = { id:string; season_key:string; title:string; starts_at:string; ends_at:string; active:boolean; week_number:number; rewardCount:number; maxLevel:number; rewards:Reward[] };
type Risk = { a:string; b:string; count:number; volume:number; score:number; aProfile:Profile|null; bProfile:Profile|null };
type Payload = {
  stars:{summary:{paid:number;refunded:number;pending:number;expired:number;paidStars:number;refundedStars:number;pendingStars:number};purchases:StarPurchase[]};
  cases:CaseRow[];
  seasons:Season[];
  economy:{daily:Array<{date?:string;emission?:number;burned?:number;net?:number}>;topRecipients:Array<{profileId?:string;amount?:number;profile?:Profile|null}>};
  risks:Risk[];
  checkedAt:string;
};
type Tab = "payments"|"economy"|"cases"|"seasons"|"risk"|"bulk";

async function request<T>(url:string,init?:RequestInit):Promise<T>{
  const headers=new Headers(init?.headers);
  if(init?.body&&!headers.has("content-type"))headers.set("content-type","application/json");
  const response=await fetch(url,{...init,headers,cache:"no-store"});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof body.error==="string"?body.error:`Ошибка ${response.status}`);
  return body as T;
}
function fmt(value:unknown,digits=2){const n=Number(value||0);return Number.isFinite(n)?new Intl.NumberFormat("ru-RU",{maximumFractionDigits:digits}).format(n):"0";}
function date(value:string|null|undefined){if(!value)return "—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":d.toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});}
function who(profile:Profile|null|undefined){return profile?(profile.username?`@${profile.username}`:profile.first_name):"Неизвестный профиль";}
function copy(value:string){void navigator.clipboard?.writeText(value);}

export default function AdvancedOpsPage(){
  const [data,setData]=useState<Payload|null>(null);
  const [tab,setTab]=useState<Tab>("payments");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);setError(null);
    try{setData(await request<Payload>("/api/admin/ops/advanced"));}
    catch(e){setError(e instanceof Error?e.message:"Не удалось загрузить Advanced Ops");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);

  async function act(action:string,payload:Record<string,unknown>={}){
    if(busy)return;
    setBusy(action);setError(null);setNotice(null);
    try{
      const result=await request<Record<string,unknown>>("/api/admin/ops/advanced",{method:"POST",body:JSON.stringify({action,...payload})});
      const count=Number(result.changed||0);
      setNotice(count>0?`Готово · изменено ${count}`:"Изменение применено");
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Операция не выполнена");}
    finally{setBusy(null);}
  }

  const nav:Array<[Tab,string,typeof Star]>=[
    ["payments","Stars",Star],["economy","Экономика",BarChart3],["cases","Loot & Cases",Boxes],
    ["seasons","Сезоны",Layers3],["risk","Risk Lab",ShieldAlert],["bulk","Bulk",Users],
  ];

  return <div className="control-root min-h-[100dvh] bg-[var(--background)] text-[var(--foreground)]">
    <aside className="control-sidebar">
      <div className="px-3 py-2">
        <Link href="/admin/ops" className="flex items-center gap-2 text-[10px] text-[var(--muted)] hover:text-white"><ArrowLeft size={13}/>MemeX Ops</Link>
        <div className="mt-4 text-sm font-semibold">Advanced Ops</div>
        <div className="mt-0.5 text-[9px] text-[var(--muted)]">PAYMENTS · CONTENT · RISK</div>
      </div>
      <nav className="mt-4 space-y-1">{nav.map(([key,label,Icon])=><button key={key} onClick={()=>setTab(key)} className={`control-nav ${tab===key?"control-nav-active":""}`}><Icon size={15}/><span>{label}</span></button>)}</nav>
      <div className="mt-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[9px] leading-4 text-[var(--muted)]"><ShieldCheck size={12} className="mb-1"/>Только Telegram-админы.<br/>Все mutations проходят same-origin, rate limit и audit.</div>
    </aside>
    <main className="control-main">
      <header className="control-topbar"><div><h1 className="text-base font-semibold">{nav.find(v=>v[0]===tab)?.[1]}</h1><p className="text-[9px] text-[var(--muted)]">{data?`Снимок ${date(data.checkedAt)}`:"Загрузка"}</p></div><button onClick={()=>void load()} disabled={loading||Boolean(busy)} className="control-icon ml-auto"><RefreshCw size={14} className={loading?"animate-spin":""}/></button></header>
      {error?<div className="control-alert control-alert-error">{error}</div>:null}
      {notice?<div className="control-alert control-alert-ok">{notice}</div>:null}
      {!data?<Loading/>:<div className="space-y-4 pb-10">
        <TopStrip data={data}/>
        {tab==="payments"?<Payments data={data} act={act} busy={busy}/>:null}
        {tab==="economy"?<Economy data={data}/>:null}
        {tab==="cases"?<Cases data={data} act={act} busy={busy}/>:null}
        {tab==="seasons"?<Seasons data={data} act={act} busy={busy}/>:null}
        {tab==="risk"?<RiskLab data={data} act={act} busy={busy}/>:null}
        {tab==="bulk"?<Bulk act={act} busy={busy}/>:null}
      </div>}
    </main>
  </div>;
}

function TopStrip({data}:{data:Payload}){
  const high=data.risks.filter(row=>row.score>=70).length;
  const season=data.seasons.find(row=>row.active);
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
    <Stat label="Stars paid" value={fmt(data.stars.summary.paidStars,0)} sub={`${data.stars.summary.paid} платежей`}/>
    <Stat label="Refunded" value={fmt(data.stars.summary.refundedStars,0)} sub={`${data.stars.summary.refunded} возвратов`}/>
    <Stat label="Active cases" value={String(data.cases.filter(row=>row.active).length)} sub={`${data.cases.length} всего`}/>
    <Stat label="Season" value={season?.title||"Нет"} sub={season?`до ${date(season.ends_at)}`:"активный сезон не выбран"}/>
    <Stat label="High risk" value={String(high)} sub={`${data.risks.length} связок`} danger={high>0}/>
  </div>;
}

function Payments({data,act,busy}:{data:Payload;act:(a:string,p?:Record<string,unknown>)=>Promise<void>;busy:string|null}){
  const [status,setStatus]=useState("all");
  const rows=data.stars.purchases.filter(row=>status==="all"||row.status===status);
  return <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
    <Panel title="Stars transactions" right={<select className="control-input !h-8 !w-36" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Все</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="refunded">Refunded</option><option value="expired">Expired</option></select>}>
      <div className="divide-y divide-[var(--border)]">{rows.slice(0,120).map(row=><div key={row.id} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-[11px] font-medium">{who(row.profile)}</p><Badge bad={row.status==="refunded"}>{row.status}</Badge><Badge>{row.product_sku||"unknown sku"}</Badge></div><p className="mt-1 truncate text-[8px] text-[var(--muted)]">{row.stars} Stars · {date(row.paid_at||row.created_at)} · {row.id}</p>{row.refund_reason?<p className="mt-1 text-[8px] text-[var(--negative)]">{row.refund_reason}</p>:null}</div><div className="flex gap-1.5"><button className="control-small" onClick={()=>copy(row.id)}><Copy size={11}/> ID</button>{row.status==="paid"?<button className="control-small" disabled={Boolean(busy)} onClick={()=>{const reason=prompt("Причина возврата","Refund via Advanced Ops");if(reason&&confirm(`Вернуть ${row.stars} Stars пользователю ${who(row.profile)}?`))void act("stars.refund",{purchaseId:row.id,reason});}}><RotateCcw size={11}/> Refund</button>:null}</div></div>)}</div>
    </Panel>
    <Panel title="90 дней"><div className="grid grid-cols-2 gap-2"><Mini label="Paid" value={`${data.stars.summary.paid} / ${fmt(data.stars.summary.paidStars,0)} ★`}/><Mini label="Pending" value={`${data.stars.summary.pending} / ${fmt(data.stars.summary.pendingStars,0)} ★`}/><Mini label="Refunded" value={`${data.stars.summary.refunded} / ${fmt(data.stars.summary.refundedStars,0)} ★`}/><Mini label="Expired" value={String(data.stars.summary.expired)}/></div><p className="mt-3 text-[8px] leading-4 text-[var(--muted)]">Refund выполняет Telegram Bot API, затем локальный transition и автоматический fulfillment reversal v0.74.</p></Panel>
  </div>;
}

function Economy({data}:{data:Payload}){
  const rows=data.economy.daily.slice(-21);
  const max=Math.max(1,...rows.map(row=>Math.abs(Number(row.net||0))));
  return <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
    <Panel title="MXM net flow · 21d"><div className="flex h-56 items-end gap-1 overflow-x-auto border-b border-[var(--border)] pb-2">{rows.map((row,index)=>{const net=Number(row.net||0);const height=Math.max(4,Math.round(Math.abs(net)/max*175));return <div key={`${row.date}-${index}`} className="flex min-w-8 flex-1 flex-col items-center justify-end gap-1"><div title={`Net ${fmt(net)} · emission ${fmt(row.emission)} · burn ${fmt(row.burned)}`} className={`w-full max-w-8 rounded-t-md ${net>=0?"bg-[var(--positive)]/40":"bg-[var(--negative)]/40"}`} style={{height}}/><span className="text-[6px] text-[var(--muted-2)]">{String(row.date||"").slice(5)}</span></div>})}</div><p className="mt-3 text-[8px] text-[var(--muted)]">Зелёный: эмиссия выше sink. Красный: экономика уничтожила больше MXM, чем создала.</p></Panel>
    <Panel title="Top recipients"><div className="divide-y divide-[var(--border)]">{data.economy.topRecipients.length?data.economy.topRecipients.slice(0,25).map((row,index)=><div key={`${row.profileId}-${index}`} className="flex items-center gap-3 py-2"><span className="w-5 text-[8px] text-[var(--muted)]">#{index+1}</span><span className="min-w-0 flex-1 truncate text-[10px]">{who(row.profile)}</span><span className="text-[9px]">{fmt(row.amount)} MXM</span></div>):<Empty text="Получателей за период нет"/>}</div></Panel>
  </div>;
}

function Cases({data,act,busy}:{data:Payload;act:(a:string,p?:Record<string,unknown>)=>Promise<void>;busy:string|null}){
  const [open,setOpen]=useState<string|null>(null);
  function editCase(sku:string,key:"remainingSupply"|"rarePity"|"epicPity"|"legendaryPity",current:number){const raw=prompt(key,String(current));const value=Number(raw);if(raw!==null&&Number.isInteger(value)&&value>=0)void act("case.update",{sku,[key]:value});}
  return <div className="space-y-3">{data.cases.map(row=><Panel key={row.sku} title={`${row.title} · ${row.sku}`} right={<div className="flex items-center gap-2"><Badge>{row.tier}</Badge><button className="control-small" disabled={Boolean(busy)} onClick={()=>void act("case.update",{sku:row.sku,active:!row.active})}>{row.active?<ToggleRight size={12}/>:<ToggleLeft size={12}/>} {row.active?"ON":"OFF"}</button></div>}>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><Mini label="Supply" value={fmt(row.remaining_supply,0)} onClick={()=>editCase(row.sku,"remainingSupply",row.remaining_supply)}/><Mini label="Rare pity" value={String(row.rare_pity)} onClick={()=>editCase(row.sku,"rarePity",row.rare_pity)}/><Mini label="Epic pity" value={String(row.epic_pity)} onClick={()=>editCase(row.sku,"epicPity",row.epic_pity)}/><Mini label="Legendary pity" value={String(row.legendary_pity)} onClick={()=>editCase(row.sku,"legendaryPity",row.legendary_pity)}/><Mini label="Active weight" value={fmt(row.activeWeight,0)}/></div>
    <button className="control-small mt-3" onClick={()=>setOpen(value=>value===row.sku?null:row.sku)}>{open===row.sku?<ChevronUp size={11}/>:<ChevronDown size={11}/>} Loot table · {row.loot.length}</button>
    {open===row.sku?<div className="mt-3 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] px-3">{row.loot.map(loot=><div key={loot.id} className="grid gap-2 py-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-[10px] font-medium">{loot.reward_label}</p><Badge>{loot.rarity}</Badge>{!loot.active?<Badge bad>off</Badge>:null}</div><p className="mt-1 text-[8px] text-[var(--muted)]">{loot.reward_kind} · amount {loot.amount} · weight {loot.weight} · {(loot.chance*100).toFixed(3)}%</p></div><div className="flex gap-1.5"><button className="control-small" disabled={Boolean(busy)} onClick={()=>{const raw=prompt("Новый weight",String(loot.weight));const value=Number(raw);if(raw!==null&&Number.isInteger(value)&&value>=0)void act("case.loot.update",{lootId:loot.id,weight:value});}}>Weight</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>void act("case.loot.update",{lootId:loot.id,active:!loot.active})}>{loot.active?"Выключить":"Включить"}</button></div></div>)}</div>:null}
  </Panel>)}</div>;
}

function Seasons({data,act,busy}:{data:Payload;act:(a:string,p?:Record<string,unknown>)=>Promise<void>;busy:string|null}){
  return <div className="space-y-3">{data.seasons.map(row=><Panel key={row.id} title={row.title} right={<div className="flex gap-2"><Badge>{row.season_key}</Badge>{row.active?<Badge>ACTIVE</Badge>:null}</div>}>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><Mini label="Week" value={String(row.week_number)} onClick={()=>{const raw=prompt("Неделя",String(row.week_number));const value=Number(raw);if(raw!==null&&Number.isInteger(value)&&value>0)void act("season.update",{seasonId:row.id,weekNumber:value});}}/><Mini label="Rewards" value={String(row.rewardCount)}/><Mini label="Max level" value={String(row.maxLevel)}/><Mini label="Старт" value={date(row.starts_at)}/><Mini label="Финиш" value={date(row.ends_at)}/></div>
    <div className="mt-3 flex flex-wrap gap-1.5"><button className="control-small" disabled={Boolean(busy)} onClick={()=>{const value=prompt("Название",row.title);if(value?.trim())void act("season.update",{seasonId:row.id,title:value});}}>Название</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>{const value=prompt("Начало",row.starts_at);if(value)void act("season.update",{seasonId:row.id,startsAt:value});}}>Начало</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>{const value=prompt("Окончание",row.ends_at);if(value)void act("season.update",{seasonId:row.id,endsAt:value});}}>Окончание</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>{if(confirm(row.active?"Отключить текущий сезон?":`Сделать «${row.title}» активным?`))void act("season.update",{seasonId:row.id,active:!row.active});}}>{row.active?"Отключить":"Активировать"}</button></div>
  </Panel>)}</div>;
}

function RiskLab({data,act,busy}:{data:Payload;act:(a:string,p?:Record<string,unknown>)=>Promise<void>;busy:string|null}){
  return <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
    <Panel title="Повторные торговые пары"><div className="divide-y divide-[var(--border)]">{data.risks.length?data.risks.map((row,index)=><div key={`${row.a}-${row.b}-${index}`} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"><div><div className="flex items-center gap-2"><span className={`grid h-7 w-9 place-items-center rounded-lg border text-[10px] font-semibold ${row.score>=70?"border-[var(--negative)]/25 text-[var(--negative)]":"border-[var(--border)] text-[var(--muted)]"}`}>{row.score}</span><p className="text-[10px] font-medium">{who(row.aProfile)} ↔ {who(row.bProfile)}</p></div><p className="mt-1 pl-11 text-[8px] text-[var(--muted)]">{row.count} повторов · {fmt(row.volume)} TON</p></div><div className="flex gap-1.5"><button className="control-small" onClick={()=>copy(`${row.a}\n${row.b}`)}><Copy size={11}/> IDs</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>void act("profiles.bulk_moderate",{profileIds:[row.a,row.b],hiddenFromLeaderboard:true})}>Скрыть</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>{if(confirm("Забанить оба профиля?"))void act("profiles.bulk_moderate",{profileIds:[row.a,row.b],isBanned:true,reason:"Risk Lab suspicious pair"});}}><Ban size={11}/> Бан</button></div></div>):<Empty text="Wash-паттернов сейчас нет"/>}</div></Panel>
    <Panel title="Risk policy"><div className="space-y-2"><Health ok label="0–39" detail="низкий сигнал"/><Health ok label="40–69" detail="ручная проверка"/><Health ok={false} label="70–100" detail="сильный повторный паттерн"/></div><p className="mt-3 text-[8px] leading-4 text-[var(--muted)]">Score ничего не банит автоматически. Он только поднимает подозрительные пары выше, решение принимает админ.</p></Panel>
  </div>;
}

function Bulk({act,busy}:{act:(a:string,p?:Record<string,unknown>)=>Promise<void>;busy:string|null}){
  const [text,setText]=useState("");
  const ids=useMemo(()=>[...new Set(text.split(/[\s,;]+/).map(value=>value.trim()).filter(Boolean))].slice(0,100),[text]);
  return <div className="grid gap-4 xl:grid-cols-[1fr_.8fr]">
    <Panel title="Bulk moderation"><textarea className="control-input min-h-56 py-2 font-mono" value={text} onChange={e=>setText(e.target.value)} placeholder="Profile UUIDs через пробел, запятую или новую строку"/><p className="mt-2 text-[8px] text-[var(--muted)]">Распознано: {ids.length} · максимум 100</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><button className="control-small justify-center" disabled={Boolean(busy)||!ids.length} onClick={()=>{if(confirm(`Забанить ${ids.length} профилей?`))void act("profiles.bulk_moderate",{profileIds:ids,isBanned:true,reason:"Bulk moderation"});}}><Ban size={11}/> Ban</button><button className="control-small justify-center" disabled={Boolean(busy)||!ids.length} onClick={()=>void act("profiles.bulk_moderate",{profileIds:ids,isBanned:false})}><CheckCircle2 size={11}/> Unban</button><button className="control-small justify-center" disabled={Boolean(busy)||!ids.length} onClick={()=>void act("profiles.bulk_moderate",{profileIds:ids,hiddenFromLeaderboard:true})}>Hide leaderboard</button><button className="control-small justify-center" disabled={Boolean(busy)||!ids.length} onClick={()=>void act("profiles.bulk_moderate",{profileIds:ids,hiddenFromLeaderboard:false})}>Restore leaderboard</button></div></Panel>
    <Panel title="Safety rails"><div className="space-y-2"><Health ok label="System profiles" detail="bulk никогда их не меняет"/><Health ok label="Limit" detail="до 100 UUID за запрос"/><Health ok label="Audit" detail="каждая операция журналируется"/></div></Panel>
  </div>;
}

function Panel({title,right,children}:{title:string;right?:React.ReactNode;children:React.ReactNode}){return <section className="control-panel overflow-hidden"><div className="flex min-h-11 items-center gap-2 border-b border-[var(--border)] px-4"><h2 className="text-[10px] font-semibold">{title}</h2>{right?<div className="ml-auto">{right}</div>:null}</div><div className="p-4">{children}</div></section>}
function Stat({label,value,sub,danger=false}:{label:string;value:string;sub:string;danger?:boolean}){return <div className={`control-panel min-w-0 p-3 ${danger?"ring-1 ring-[var(--negative)]/20":""}`}><p className="text-[8px] text-[var(--muted)]">{label}</p><p className={`mt-2 truncate text-lg font-semibold ${danger?"text-[var(--negative)]":""}`}>{value}</p><p className="mt-0.5 truncate text-[8px] text-[var(--muted-2)]">{sub}</p></div>}
function Mini({label,value,onClick}:{label:string;value:string;onClick?:()=>void}){return onClick?<button onClick={onClick} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition hover:bg-white/[.035]"><p className="text-[7px] uppercase tracking-wide text-[var(--muted-2)]">{label}</p><p className="mt-1 truncate text-[10px] font-medium">{value}</p></button>:<div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><p className="text-[7px] uppercase tracking-wide text-[var(--muted-2)]">{label}</p><p className="mt-1 truncate text-[10px] font-medium">{value}</p></div>}
function Health({label,ok,detail}:{label:string;ok:boolean;detail:string}){return <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">{ok?<CheckCircle2 size={14} className="text-[var(--positive)]"/>:<ShieldAlert size={14} className="text-[var(--negative)]"/>}<div><p className="text-[10px] font-medium">{label}</p><p className="text-[8px] text-[var(--muted)]">{detail}</p></div></div>}
function Badge({children,bad=false}:{children:React.ReactNode;bad?:boolean}){return <span className={`rounded-md border px-1.5 py-0.5 text-[7px] ${bad?"border-[var(--negative)]/20 text-[var(--negative)]":"border-[var(--border)] text-[var(--muted)]"}`}>{children}</span>}
function Empty({text}:{text:string}){return <div className="py-10 text-center text-[10px] text-[var(--muted)]">{text}</div>}
function Loading(){return <div className="control-root grid min-h-[55dvh] place-items-center"><RefreshCw size={18} className="animate-spin text-[var(--muted)]"/></div>}
