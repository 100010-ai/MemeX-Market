"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Ban, BarChart3, CheckCircle2, Coins, Command, Copy, EyeOff, Gift, Gauge,
  KeyRound, ListChecks, LockKeyhole, LogOut, RefreshCw, Search, Settings2, ShieldAlert,
  ShieldCheck, Sparkles, Star, ToggleLeft, ToggleRight, Users, Wrench, XCircle,
} from "lucide-react";

type ProfileRow = { id:string; telegram_id:number; username:string|null; first_name:string; balance:number|string; xp:number|string; is_banned:boolean; ban_reason?:string|null; banned_until?:string|null; hidden_from_leaderboard:boolean; is_system:boolean; created_at:string };
type MissionRow = { id:string; key:string; period:"onboarding"|"daily"|"weekly"; title:string; description:string; reward:number|string; target:number; action_type:string; sort_order:number; active:boolean };
type CoinRow = { id:string; creator_profile_id:string|null; name:string; symbol:string; description?:string; image_url?:string|null; current_price:number|string; market_cap:number|string; status:"active"|"dead"|"graduated"; hidden_from_market:boolean; created_at:string };
type GiftRow = { virtual_gift_id:string; asset_id:string; telegram_name?:string; base_name:string; gift_number:number; owner_profile_id:string; owner_name:string; status:"owned"|"listed"; listing_price:number|string|null; estimated_value:number|string|null; is_burned?:boolean; created_at?:string; catalog_source:"profile_sync"|"bot_catalog"|"tonapi"; source_reference?:string|null };
type AuditRow = { id:string; actor:string; action:string; target_type:string|null; target_id:string|null; payload:Record<string,unknown>; created_at:string };
type SchemaHealth = { ready:boolean; schemaVersion:number; requiredSchemaVersion:number; missingRequired:string[]; missingOptional:string[]; capabilities:Array<{key:string;label:string;required:boolean;ok:boolean;code:string|null}> };
type RuntimeConfig = { maintenanceMode:boolean; maintenanceMessage:string; featureFlags:{gifts:boolean;memecoins:boolean;referrals:boolean;stars:boolean}; remoteConfig:{maxPriceAlerts:number;maxWatchlistItems:number;marketPageSize:number;coinOrderMaxOpen:number;coinOrderMaxDays:number}; updatedAt:string };
type Payload = {
  metrics:{ players:number;banned:number;hidden:number;coins:number;activeCoins:number;gifts:number;listedGifts:number;npcListings:number;catalogSources:number;tonapiAssets:number;tonapiVerified:number };
  profiles:ProfileRow[]; missions:MissionRow[]; coins:CoinRow[]; gifts:GiftRow[]; audit:AuditRow[];
  liquidity:null|{playerOnly:boolean;ready:boolean;playerOwned:number;playerListed:number;activeSellers:number;npcListed:number};
  schemaHealth:SchemaHealth; checkedAt:string;
};
type OpsPayload = { runtimeConfig:RuntimeConfig; schemaHealth:SchemaHealth; ops:{pendingStars:number|null;paidStars:number|null;refundedStars:number|null;recentErrors:number|null;openOrders:number|null}; latestErrors:Array<{route:string;error_name:string;message:string;count:number;affected_users:number;last_seen_at:string}>; checkedAt:string };
type SearchPayload = { profiles:ProfileRow[]; coins:CoinRow[]; gifts:GiftRow[] };
type Tab = "overview"|"players"|"missions"|"coins"|"gifts"|"system"|"audit";

type ActionFn = (action:string,payload?:Record<string,unknown>)=>Promise<void>;

async function request<T>(url:string, init?:RequestInit):Promise<T>{
  const headers=new Headers(init?.headers);
  if(init?.body&&!headers.has("content-type")) headers.set("content-type","application/json");
  const res=await fetch(url,{...init,headers,cache:"no-store"});
  const body=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(typeof body.error==="string"?body.error:`Ошибка ${res.status}`);
  return body as T;
}

function money(value:number|string|null|undefined){const n=Number(value||0);return Number.isFinite(n)?new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(n):"0";}
function date(value:string|null|undefined){if(!value)return "—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":d.toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});}
function copy(value:string){void navigator.clipboard?.writeText(value);}

export default function ControlPage(){
  const [available,setAvailable]=useState<boolean|null>(null);
  const [authenticated,setAuthenticated]=useState(false);
  const [token,setToken]=useState("");
  const [data,setData]=useState<Payload|null>(null);
  const [ops,setOps]=useState<OpsPayload|null>(null);
  const [tab,setTab]=useState<Tab>("overview");
  const [query,setQuery]=useState("");
  const [searchResults,setSearchResults]=useState<SearchPayload|null>(null);
  const [searching,setSearching]=useState(false);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const searchRef=useRef<HTMLInputElement>(null);

  const load=useCallback(async()=>{
    setLoading(true);setError(null);
    try{
      const [main,health]=await Promise.all([request<Payload>("/api/control/bootstrap"),request<OpsPayload>("/api/control/ops")]);
      setData(main);setOps(health);
    }catch(e){setError(e instanceof Error?e.message:"Не удалось загрузить Control Center");}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{request<{available:boolean;authenticated:boolean}>("/api/control/session").then(v=>{setAvailable(v.available);setAuthenticated(v.authenticated);if(v.authenticated)void load();}).catch(()=>setAvailable(false));},[load]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();searchRef.current?.focus();}if(e.key==="Escape"){setQuery("");setSearchResults(null);}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);},[]);
  useEffect(()=>{const q=query.trim();if(q.length<2){setSearchResults(null);return;}const timer=window.setTimeout(async()=>{setSearching(true);try{setSearchResults(await request<SearchPayload>(`/api/control/search?q=${encodeURIComponent(q)}`));}catch{setSearchResults(null);}finally{setSearching(false);}},220);return()=>window.clearTimeout(timer);},[query]);

  async function login(e:FormEvent){e.preventDefault();setBusy("login");setError(null);try{await request("/api/control/session",{method:"POST",body:JSON.stringify({token})});setAuthenticated(true);setToken("");await load();}catch(e){setError(e instanceof Error?e.message:"Вход не выполнен");}finally{setBusy(null);}}
  const act:ActionFn=async(action,payload={})=>{if(busy)return;setBusy(action);setError(null);setNotice(null);try{await request("/api/control/action",{method:"POST",body:JSON.stringify({action,...payload})});setNotice("Изменение применено");await load();}catch(e){setError(e instanceof Error?e.message:"Операция не выполнена");}finally{setBusy(null);}};
  async function op(action:string,payload:Record<string,unknown>={}){if(busy)return;setBusy(action);setError(null);setNotice(null);try{await request("/api/control/ops",{method:"POST",body:JSON.stringify({action,...payload})});setNotice("Системная операция выполнена");await load();}catch(e){setError(e instanceof Error?e.message:"Системная операция не выполнена");}finally{setBusy(null);}}
  async function logout(){await request("/api/control/session",{method:"DELETE"}).catch(()=>null);setAuthenticated(false);setData(null);setOps(null);}

  if(available===null)return <Loading/>;
  if(!available)return <Gate icon={<LockKeyhole size={22}/>} title="Control Center недоступен" text="Локальная панель работает только через localhost/127.0.0.1."/>;
  if(!authenticated)return <div className="control-root grid min-h-[100dvh] place-items-center p-5"><form onSubmit={login} className="control-panel w-full max-w-md p-6"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--panel-2)]"><KeyRound size={19}/></div><h1 className="mt-4 text-xl font-semibold">MemeX Control Center</h1><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Операционная панель проекта. Сессия HttpOnly, доступ только локально, действия пишутся в audit log.</p><input className="control-input mt-5" type="password" autoFocus value={token} onChange={e=>setToken(e.target.value)} placeholder="Ключ из .mxm-control-secret"/><button className="control-primary mt-3 w-full" disabled={busy==="login"||token.length<8}>{busy==="login"?"Проверяем…":"Открыть Control Center"}</button>{error?<p className="mt-3 text-xs text-[var(--negative)]">{error}</p>:null}</form></div>;

  const nav:Array<[Tab,string,typeof Gauge]>=[["overview","Обзор",Gauge],["players","Игроки",Users],["missions","Задания",ListChecks],["coins","Мемкоины",Coins],["gifts","Gifts",Gift],["system","Система",Settings2],["audit","Аудит",ShieldCheck]];
  const counts:Partial<Record<Tab,number>>={players:data?.metrics.players,missions:data?.missions.length,coins:data?.metrics.coins,gifts:data?.metrics.gifts,audit:data?.audit.length};

  return <div className="control-root min-h-[100dvh] bg-[var(--background)] text-[var(--foreground)]">
    <aside className="control-sidebar">
      <div className="px-3 py-2"><div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--panel-2)]"><Command size={15}/></div><div><div className="text-sm font-semibold">MXM Control</div><div className="text-[9px] text-[var(--muted)]">OPERATOR CENTER</div></div></div></div>
      <nav className="mt-4 space-y-1">{nav.map(([key,label,Icon])=><button key={key} onClick={()=>setTab(key)} className={`control-nav ${tab===key?"control-nav-active":""}`}><Icon size={15}/><span className="min-w-0 flex-1 text-left">{label}</span>{counts[key]!=null?<small className="control-nav-count">{counts[key]}</small>:null}</button>)}</nav>
      <div className="mt-auto space-y-2"><div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[9px] leading-4 text-[var(--muted)]"><ShieldCheck size={12} className="mb-1"/>localhost only<br/>HttpOnly session<br/>полный audit trail</div><button onClick={()=>void logout()} className="control-nav w-full"><LogOut size={14}/><span>Выйти</span></button></div>
    </aside>

    <main className="control-main">
      <header className="control-topbar gap-3">
        <div className="min-w-0"><h1 className="truncate text-base font-semibold">{nav.find(v=>v[0]===tab)?.[1]}</h1><p className="text-[9px] text-[var(--muted)]">{data?`Снимок ${date(data.checkedAt)}`:"Загрузка"}</p></div>
        <div className="relative ml-auto min-w-0 flex-1 max-w-xl"><label className="control-search w-full"><Search size={13}/><input ref={searchRef} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Игрок, Telegram ID, $тикер, Gift…"/><kbd className="hidden rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[8px] text-[var(--muted)] sm:inline">Ctrl K</kbd></label>{query.trim().length>=2?<GlobalSearch query={query} loading={searching} data={searchResults} onClose={()=>{setQuery("");setSearchResults(null);}} setTab={setTab}/>:null}</div>
        <button disabled={loading||Boolean(busy)} onClick={()=>void load()} className="control-icon" title="Обновить"><RefreshCw size={14} className={loading?"animate-spin":""}/></button>
      </header>

      {error?<div className="control-alert control-alert-error" role="alert">{error}</div>:null}{notice?<div className="control-alert control-alert-ok" role="status">{notice}</div>:null}
      {!data||!ops?<Loading/>:<div className="space-y-4 pb-8">
        <StatusBar data={data} ops={ops}/>
        {tab==="overview"?<Overview data={data} ops={ops} act={act} op={op} busy={busy}/>:null}
        {tab==="players"?<Players rows={data.profiles} act={act} busy={busy}/>:null}
        {tab==="missions"?<Missions rows={data.missions} act={act} busy={busy}/>:null}
        {tab==="coins"?<CoinsPanel rows={data.coins} act={act} busy={busy}/>:null}
        {tab==="gifts"?<GiftsPanel rows={data.gifts} profiles={data.profiles} act={act} busy={busy} liquidity={data.liquidity}/>:null}
        {tab==="system"?<SystemPanel data={data} ops={ops} act={act} op={op} busy={busy}/>:null}
        {tab==="audit"?<AuditPanel rows={data.audit}/>:null}
      </div>}
    </main>
  </div>;
}

function StatusBar({data,ops}:{data:Payload;ops:OpsPayload}){
  const danger=(ops.ops.recentErrors||0)>0||!data.schemaHealth.ready;
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
    <Stat icon={<Users size={14}/>} label="Игроки" value={String(data.metrics.players)} sub={`${data.metrics.banned} заблокировано`}/>
    <Stat icon={<Coins size={14}/>} label="Мемкоины" value={String(data.metrics.activeCoins)} sub={`${data.metrics.coins} всего`}/>
    <Stat icon={<Gift size={14}/>} label="Gifts на рынке" value={String(data.metrics.listedGifts)} sub={`${data.metrics.gifts} в каталоге`}/>
    <Stat icon={<Star size={14}/>} label="Stars pending" value={ops.ops.pendingStars==null?"—":String(ops.ops.pendingStars)} sub={`${ops.ops.refundedStars??0} refunds`}/>
    <Stat icon={danger?<ShieldAlert size={14}/>:<CheckCircle2 size={14}/>} label="Состояние" value={danger?"Нужно внимание":"Норма"} sub={`${ops.ops.recentErrors??0} ошибок / 24ч`} danger={danger}/>
  </div>;
}

function Overview({data,ops,act,op,busy}:{data:Payload;ops:OpsPayload;act:ActionFn;op:(a:string,p?:Record<string,unknown>)=>Promise<void>;busy:string|null}){
  const recentPlayers=data.profiles.filter(v=>!v.is_system).slice(0,5);
  const recentAudit=data.audit.slice(0,6);
  return <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
    <div className="space-y-4">
      <Panel title="Быстрые действия" icon={<Sparkles size={14}/>}><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Quick title="Синхронизировать Gifts" text="TonAPI + источники" onClick={()=>void act("catalog.sync")} disabled={Boolean(busy)} icon={<RefreshCw size={15}/>}/><Quick title="Genesis liquidity" text="Поддержать листинги" onClick={()=>void act("npc.tick",{targetListings:1000})} disabled={Boolean(busy)||Boolean(data.liquidity?.playerOnly)} icon={<Gift size={15}/>}/><Quick title="Освободить Stars" text="Expired reservations" onClick={()=>void op("stars.release_expired")} disabled={Boolean(busy)} icon={<Star size={15}/>}/><Quick title={ops.runtimeConfig.maintenanceMode?"Выключить техработы":"Включить техработы"} text="Maintenance mode" onClick={()=>void op("runtime.update",{config:{...ops.runtimeConfig,maintenanceMode:!ops.runtimeConfig.maintenanceMode}})} disabled={Boolean(busy)} icon={<Wrench size={15}/>}/></div></Panel>
      <Panel title="Последние игроки" icon={<Users size={14}/>}><div className="divide-y divide-[var(--border)]">{recentPlayers.map(p=><PlayerRow key={p.id} p={p} act={act} busy={busy}/>)}</div></Panel>
      <Panel title="Последние действия оператора" icon={<Activity size={14}/>}><AuditRows rows={recentAudit}/></Panel>
    </div>
    <div className="space-y-4">
      <Panel title="Health monitor" icon={<Gauge size={14}/>}><div className="space-y-2"><Health label="Schema" ok={data.schemaHealth.ready} detail={`v${data.schemaHealth.schemaVersion} / required ${data.schemaHealth.requiredSchemaVersion}`}/><Health label="Runtime" ok={!ops.runtimeConfig.maintenanceMode} detail={ops.runtimeConfig.maintenanceMode?"Maintenance включён":"Рабочий режим"}/><Health label="Recent errors" ok={(ops.ops.recentErrors||0)===0} detail={`${ops.ops.recentErrors??0} за 24 часа`}/><Health label="Conditional orders" ok={true} detail={`${ops.ops.openOrders??0} открыто`}/></div></Panel>
      <Panel title="Свежие ошибки" icon={<ShieldAlert size={14}/>}><div className="space-y-2">{ops.latestErrors.length?ops.latestErrors.map((e,i)=><div key={`${e.route}-${i}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="flex gap-2"><span className="min-w-0 flex-1 truncate text-[10px] font-medium">{e.route}</span><span className="text-[8px] text-[var(--muted)]">×{e.count}</span></div><p className="mt-1 line-clamp-2 text-[9px] leading-4 text-[var(--muted)]">{e.message}</p><p className="mt-1 text-[8px] text-[var(--muted-2)]">{date(e.last_seen_at)}</p></div>):<div className="py-8 text-center text-[10px] text-[var(--muted)]">За последние сутки тихо</div>}</div></Panel>
    </div>
  </div>;
}

function Players({rows,act,busy}:{rows:ProfileRow[];act:ActionFn;busy:string|null}){const [filter,setFilter]=useState("");const list=useMemo(()=>rows.filter(p=>!p.is_system&&(!filter||`${p.first_name} ${p.username||""} ${p.telegram_id}`.toLowerCase().includes(filter.toLowerCase()))).slice(0,250),[rows,filter]);return <Panel title="Игроки" icon={<Users size={14}/>} right={<input className="control-input !h-8 !w-56" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Фильтр списка"/>}><div className="divide-y divide-[var(--border)]">{list.map(p=><PlayerRow key={p.id} p={p} act={act} busy={busy}/>)}</div></Panel>}
function PlayerRow({p,act,busy}:{p:ProfileRow;act:ActionFn;busy:string|null}){return <div className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-[11px] font-medium">{p.username?`@${p.username}`:p.first_name}</p>{p.is_banned?<Badge bad>ban</Badge>:null}{p.hidden_from_leaderboard?<Badge>hidden</Badge>:null}</div><p className="mt-1 text-[8px] text-[var(--muted)]">TG {p.telegram_id} · {money(p.balance)} TON · {money(p.xp)} XP</p></div><div className="flex flex-wrap gap-1.5"><button className="control-small" onClick={()=>copy(String(p.telegram_id))}><Copy size={11}/> ID</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>{const raw=prompt("Изменить баланс на", "100");if(raw!=null&&Number.isFinite(Number(raw)))void act("balance.adjust",{profileId:p.id,delta:Number(raw),reason:"Control Center quick adjust"});}}><Coins size={11}/> Баланс</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>void act("profile.moderate",{profileId:p.id,hiddenFromLeaderboard:!p.hidden_from_leaderboard})}><EyeOff size={11}/> {p.hidden_from_leaderboard?"Вернуть":"Скрыть"}</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>void act("profile.moderate",{profileId:p.id,isBanned:!p.is_banned,banReason:p.is_banned?null:"Control Center",bannedUntil:null})}><Ban size={11}/> {p.is_banned?"Разбан":"Бан"}</button></div></div>}

function Missions({rows,act,busy}:{rows:MissionRow[];act:ActionFn;busy:string|null}){return <Panel title="Задания" icon={<ListChecks size={14}/>} right={<button className="control-primary !min-h-8 !px-3" onClick={()=>{const title=prompt("Название задания");if(!title)return;const key=`manual_${Date.now()}`;void act("mission.create",{key,title,description:title,period:"daily",reward:100,target:1,actionType:"manual",sortOrder:100});}}>+ Быстрое задание</button>}><div className="divide-y divide-[var(--border)]">{rows.map(m=><div key={m.id} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"><div><div className="flex items-center gap-2"><p className="text-[11px] font-medium">{m.title}</p><Badge>{m.period}</Badge>{!m.active?<Badge bad>off</Badge>:null}</div><p className="mt-1 text-[8px] text-[var(--muted)]">{m.key} · цель {m.target} · награда {money(m.reward)} MXM</p></div><div className="flex gap-1.5"><button className="control-small" disabled={Boolean(busy)} onClick={()=>void act("mission.update",{id:m.id,active:!m.active})}>{m.active?<ToggleRight size={12}/>:<ToggleLeft size={12}/>} {m.active?"Выключить":"Включить"}</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>{if(confirm(`Удалить «${m.title}»?`))void act("mission.delete",{id:m.id});}}><XCircle size={12}/> Удалить</button></div></div>)}</div></Panel>}

function CoinsPanel({rows,act,busy}:{rows:CoinRow[];act:ActionFn;busy:string|null}){return <Panel title="Мемкоины" icon={<Coins size={14}/>}><div className="divide-y divide-[var(--border)]">{rows.slice(0,300).map(c=><div key={c.id} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"><div><div className="flex items-center gap-2"><p className="text-[11px] font-medium">{c.name} <span className="text-[var(--muted)]">${c.symbol}</span></p><Badge>{c.status}</Badge>{c.hidden_from_market?<Badge bad>hidden</Badge>:null}</div><p className="mt-1 text-[8px] text-[var(--muted)]">MC {money(c.market_cap)} · price {money(c.current_price)}</p></div><div className="flex flex-wrap gap-1.5"><button className="control-small" onClick={()=>copy(c.id)}><Copy size={11}/> ID</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>void act("coin.update",{id:c.id,hiddenFromMarket:!c.hidden_from_market})}><EyeOff size={11}/> {c.hidden_from_market?"Показать":"Скрыть"}</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>void act("coin.update",{id:c.id,status:c.status==="dead"?"active":"dead"})}><ShieldAlert size={11}/> {c.status==="dead"?"Оживить":"Стоп"}</button></div></div>)}</div></Panel>}

function GiftsPanel({rows,profiles,act,busy,liquidity}:{rows:GiftRow[];profiles:ProfileRow[];act:ActionFn;busy:string|null;liquidity:Payload["liquidity"]}){const [filter,setFilter]=useState("");const list=rows.filter(g=>!filter||`${g.base_name} ${g.gift_number} ${g.owner_name}`.toLowerCase().includes(filter.toLowerCase())).slice(0,300);return <div className="space-y-4"><Panel title="Рынок Gifts" icon={<Gift size={14}/>} right={<div className="flex gap-2"><input className="control-input !h-8 !w-56" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Gift / владелец"/><button className="control-small" disabled={Boolean(busy)} onClick={()=>void act("catalog.sync")}><RefreshCw size={11}/> Sync</button></div>}><div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[9px] text-[var(--muted)]">Режим рынка: <b className="text-[var(--foreground)]">{liquidity?.playerOnly?"player only":"NPC bootstrap"}</b> · игроков лотов {liquidity?.playerListed??0} · NPC {liquidity?.npcListed??0}</div><div className="divide-y divide-[var(--border)]">{list.map(g=><div key={g.virtual_gift_id} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"><div><p className="text-[11px] font-medium">{g.base_name} #{g.gift_number}</p><p className="mt-1 text-[8px] text-[var(--muted)]">{g.owner_name} · {g.status} · {g.listing_price?`${money(g.listing_price)} TON`:"не выставлен"} · {g.catalog_source}</p></div><div className="flex flex-wrap gap-1.5"><button className="control-small" onClick={()=>copy(g.virtual_gift_id)}><Copy size={11}/> ID</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>{if(g.status==="listed")void act("gift.list",{id:g.virtual_gift_id,price:null});else{const raw=prompt("Цена TON",String(g.estimated_value||1));if(raw&&Number(raw)>0)void act("gift.list",{id:g.virtual_gift_id,price:Number(raw)});}}}>{g.status==="listed"?"Снять":"Выставить"}</button><button className="control-small" disabled={Boolean(busy)} onClick={()=>{const target=prompt("Profile ID нового владельца");if(target&&profiles.some(p=>p.id===target))void act("gift.transfer",{id:g.virtual_gift_id,ownerProfileId:target});}}>Передать</button></div></div>)}</div></Panel></div>}

function SystemPanel({data,ops,act,op,busy}:{data:Payload;ops:OpsPayload;act:ActionFn;op:(a:string,p?:Record<string,unknown>)=>Promise<void>;busy:string|null}){const [cfg,setCfg]=useState<RuntimeConfig>(ops.runtimeConfig);useEffect(()=>setCfg(ops.runtimeConfig),[ops.runtimeConfig]);const save=()=>void op("runtime.update",{config:cfg});return <div className="grid gap-4 xl:grid-cols-2"><Panel title="Runtime Config" icon={<Settings2 size={14}/>} right={<button className="control-primary !min-h-8 !px-3" disabled={Boolean(busy)} onClick={save}>Сохранить</button>}><label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-3"><div><p className="text-[10px] font-medium">Maintenance mode</p><p className="text-[8px] text-[var(--muted)]">Закрывает приложение для пользователей</p></div><button onClick={()=>setCfg(v=>({...v,maintenanceMode:!v.maintenanceMode}))}>{cfg.maintenanceMode?<ToggleRight size={24}/>:<ToggleLeft size={24}/>}</button></label><textarea className="control-input mt-2 min-h-20 py-2" value={cfg.maintenanceMessage} onChange={e=>setCfg(v=>({...v,maintenanceMessage:e.target.value}))}/><div className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(cfg.featureFlags).map(([key,value])=><button key={key} onClick={()=>setCfg(v=>({...v,featureFlags:{...v.featureFlags,[key]:!value}}))} className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left"><div><p className="text-[10px] font-medium">{key}</p><p className="text-[8px] text-[var(--muted)]">Feature flag</p></div>{value?<ToggleRight size={20}/>:<ToggleLeft size={20}/>}</button>)}</div></Panel><Panel title="Operations" icon={<Wrench size={14}/>}><div className="grid gap-2 sm:grid-cols-2"><Quick title="Release expired Stars" text={`${ops.ops.pendingStars??0} pending`} onClick={()=>void op("stars.release_expired")} disabled={Boolean(busy)} icon={<Star size={15}/>}/><Quick title="Catalog sync" text={`${data.metrics.tonapiAssets} TonAPI assets`} onClick={()=>void act("catalog.sync")} disabled={Boolean(busy)} icon={<RefreshCw size={15}/>}/><Quick title="Genesis tick" text={`${data.metrics.npcListings} NPC listings`} onClick={()=>void act("npc.tick",{targetListings:1000})} disabled={Boolean(busy)||Boolean(data.liquidity?.playerOnly)} icon={<Gift size={15}/>}/><Quick title="Player handoff" text="Отключить NPC рынок" onClick={()=>{if(confirm("Принудительно передать Gift-рынок игрокам?"))void act("npc.handoff");}} disabled={Boolean(busy)||Boolean(data.liquidity?.playerOnly)} icon={<Users size={15}/>}/></div><div className="mt-3 space-y-2"><Health label="Schema" ok={data.schemaHealth.ready} detail={`${data.schemaHealth.missingRequired.length} required missing`}/><Health label="TonAPI verified" ok={data.metrics.tonapiVerified>0} detail={`${data.metrics.tonapiVerified}/${data.metrics.tonapiAssets}`}/><Health label="Errors 24h" ok={(ops.ops.recentErrors||0)===0} detail={String(ops.ops.recentErrors??0)}/></div></Panel></div>}
function AuditPanel({rows}:{rows:AuditRow[]}){return <Panel title="Audit trail" icon={<ShieldCheck size={14}/>}><AuditRows rows={rows.slice(0,300)}/></Panel>}
function AuditRows({rows}:{rows:AuditRow[]}){return <div className="divide-y divide-[var(--border)]">{rows.map(a=><div key={a.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><p className="truncate text-[10px] font-medium">{a.action}</p><p className="mt-1 truncate text-[8px] text-[var(--muted)]">{a.actor} · {a.target_type||"system"} {a.target_id||""}</p></div><span className="text-[8px] text-[var(--muted-2)]">{date(a.created_at)}</span></div>)}</div>}

function GlobalSearch({query,loading,data,onClose,setTab}:{query:string;loading:boolean;data:SearchPayload|null;onClose:()=>void;setTab:(v:Tab)=>void}){const count=(data?.profiles.length||0)+(data?.coins.length||0)+(data?.gifts.length||0);return <div className="absolute left-0 right-0 top-[42px] z-50 max-h-[70vh] overflow-auto rounded-2xl border border-[var(--border)] bg-[#0d1117] p-2 shadow-2xl"><div className="flex items-center justify-between px-2 py-1 text-[9px] text-[var(--muted)]"><span>{loading?"Ищем…":`${count} результатов для «${query}»`}</span><button onClick={onClose}><XCircle size={13}/></button></div>{data?.profiles.map(p=><button key={p.id} onClick={()=>{setTab("players");onClose();}} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[.04]"><Users size={13}/><span className="min-w-0 flex-1 truncate text-[10px]">{p.username?`@${p.username}`:p.first_name}</span><small className="text-[8px] text-[var(--muted)]">TG {p.telegram_id}</small></button>)}{data?.coins.map(c=><button key={c.id} onClick={()=>{setTab("coins");onClose();}} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[.04]"><Coins size={13}/><span className="min-w-0 flex-1 truncate text-[10px]">{c.name} ${c.symbol}</span><small className="text-[8px] text-[var(--muted)]">{c.status}</small></button>)}{data?.gifts.map(g=><button key={g.virtual_gift_id} onClick={()=>{setTab("gifts");onClose();}} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[.04]"><Gift size={13}/><span className="min-w-0 flex-1 truncate text-[10px]">{g.base_name} #{g.gift_number}</span><small className="text-[8px] text-[var(--muted)]">{g.owner_name}</small></button>)}{!loading&&count===0?<div className="py-8 text-center text-[10px] text-[var(--muted)]">Ничего не найдено</div>:null}</div>}
function Panel({title,icon,right,children}:{title:string;icon:React.ReactNode;right?:React.ReactNode;children:React.ReactNode}){return <section className="control-panel overflow-hidden"><div className="flex min-h-11 items-center gap-2 border-b border-[var(--border)] px-4"><span className="text-[var(--accent)]">{icon}</span><h2 className="text-[10px] font-semibold">{title}</h2>{right?<div className="ml-auto">{right}</div>:null}</div><div className="p-4">{children}</div></section>}
function Stat({icon,label,value,sub,danger=false}:{icon:React.ReactNode;label:string;value:string;sub:string;danger?:boolean}){return <div className={`control-panel p-3 ${danger?"ring-1 ring-[var(--negative)]/20":""}`}><div className="flex items-center gap-2 text-[9px] text-[var(--muted)]">{icon}{label}</div><p className={`mt-2 text-lg font-semibold ${danger?"text-[var(--negative)]":""}`}>{value}</p><p className="mt-0.5 text-[8px] text-[var(--muted-2)]">{sub}</p></div>}
function Quick({title,text,onClick,disabled,icon}:{title:string;text:string;onClick:()=>void;disabled:boolean;icon:React.ReactNode}){return <button disabled={disabled} onClick={onClick} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition hover:bg-white/[.035] disabled:opacity-40"><span className="text-[var(--accent)]">{icon}</span><p className="mt-2 text-[10px] font-medium">{title}</p><p className="mt-1 text-[8px] text-[var(--muted)]">{text}</p></button>}
function Health({label,ok,detail}:{label:string;ok:boolean;detail:string}){return <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">{ok?<CheckCircle2 size={14} className="text-[var(--positive)]"/>:<ShieldAlert size={14} className="text-[var(--negative)]"/>}<div className="min-w-0 flex-1"><p className="text-[10px] font-medium">{label}</p><p className="truncate text-[8px] text-[var(--muted)]">{detail}</p></div></div>}
function Badge({children,bad=false}:{children:React.ReactNode;bad?:boolean}){return <span className={`rounded-md border px-1.5 py-0.5 text-[7px] ${bad?"border-[var(--negative)]/20 text-[var(--negative)]":"border-[var(--border)] text-[var(--muted)]"}`}>{children}</span>}
function Loading(){return <div className="control-root grid min-h-[45dvh] place-items-center"><RefreshCw size={18} className="animate-spin text-[var(--muted)]"/></div>}
function Gate({icon,title,text}:{icon:React.ReactNode;title:string;text:string}){return <div className="control-root grid min-h-[100dvh] place-items-center p-5"><div className="control-panel max-w-lg p-6">{icon}<h1 className="mt-4 text-lg font-semibold">{title}</h1><p className="mt-2 text-sm text-[var(--muted)]">{text}</p></div></div>}
