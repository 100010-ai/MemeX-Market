"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleDollarSign, Coins, Dices, RotateCw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import { PrimaryButton } from "@/components/ui";
import { useTelegramProfile } from "@/components/telegram-provider";

type Game = "coinflip" | "dice" | "wheel";
type Round = { id:string;game:Game;bet:number;choice:string|null;result:string;number:number|null;multiplier:number;payout:number;balanceAfter:number;createdAt:string };
type Payload = { balance:number;availableBalance:number;reservedBalance:number;rounds:Round[] };

const games = [
  { id:"coinflip" as const, title:"Монета", subtitle:"50/50 · выплата x1.92", icon:Coins },
  { id:"dice" as const, title:"Кубик 49", subtitle:"49% · выплата x1.96", icon:Dices },
  { id:"wheel" as const, title:"Колесо", subtitle:"до x8 · фиксированные шансы", icon:RotateCw },
];

export default function GamesPage() {
  const [data,setData]=useState<Payload|null>(null);
  const [game,setGame]=useState<Game>("coinflip");
  const [bet,setBet]=useState("1");
  const [choice,setChoice]=useState("heads");
  const [busy,setBusy]=useState(false);
  const [last,setLast]=useState<Round|null>(null);
  const [error,setError]=useState<string|null>(null);
  const { refreshProfile,patchProfile,haptic }=useTelegramProfile();

  const load=useCallback(async()=>{try{setData(await apiFetch<Payload>("/api/games"));setError(null);}catch(e){setError(e instanceof Error?e.message:"Не удалось загрузить игры");}},[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(game==="coinflip")setChoice("heads");else if(game==="dice")setChoice("low");else setChoice("");},[game]);
  const amount=Number(bet);
  const canPlay=Boolean(data&&Number.isFinite(amount)&&amount>=0.1&&amount<=Math.min(100,data.availableBalance)&&!busy);

  async function play(){
    if(!canPlay)return;
    setBusy(true);setError(null);haptic("medium");
    try{
      const result=await apiFetch<{round:any}>("/api/games/play",{method:"POST",body:JSON.stringify({game,bet:amount,choice:game==="wheel"?null:choice})});
      const row:Round={id:String(result.round.id),game:result.round.game,bet:Number(result.round.bet),choice:result.round.choice??null,result:String(result.round.result),number:result.round.number==null?null:Number(result.round.number),multiplier:Number(result.round.multiplier),payout:Number(result.round.payout),balanceAfter:Number(result.round.balance),createdAt:new Date().toISOString()};
      setLast(row);
      setData((current)=>current?{...current,balance:row.balanceAfter,availableBalance:Math.max(0,row.balanceAfter-current.reservedBalance),rounds:[row,...current.rounds].slice(0,30)}:current);
      patchProfile({ balance: row.balanceAfter, availableBalance: Math.max(0,row.balanceAfter-(data?.reservedBalance||0)) });
      haptic(row.multiplier>0?"light":"medium");
      void refreshProfile();
    }catch(e){setError(e instanceof Error?e.message:"Раунд не выполнен");}
    finally{setBusy(false);}
  }

  const recent=useMemo(()=>data?.rounds||[],[data]);
  return <div className="mx-auto max-w-3xl mxm-page-enter">
    <div className="mb-4 border-b border-[var(--border-soft)] pb-3"><h1 className="text-[17px] font-semibold">Игровой хаб</h1><p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">Только виртуальный TON внутри MXM. Его нельзя купить, вывести или обменять на реальные деньги.</p></div>

    <div className="mxm-hscroll mb-5 gap-5 border-b border-[var(--border-soft)] pb-2">{games.map((item)=>{const Icon=item.icon;return <button key={item.id} onClick={()=>setGame(item.id)} className={`flex shrink-0 items-center gap-2 border-b pb-2 text-left ${game===item.id?"border-white text-white":"border-transparent text-[var(--muted)]"}`}><Icon size={15}/><span><span className="block text-xs font-medium">{item.title}</span><span className="block text-[9px]">{item.subtitle}</span></span></button>})}</div>

    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_250px]">
      <section>
        <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] text-[var(--muted)]">Доступно</p><p className="mt-1 text-lg font-semibold">{data?money(data.availableBalance):"—"}</p></div><CircleDollarSign size={22} className="text-[var(--muted)]"/></div>
        <div className="mt-4"><label className="text-[10px] text-[var(--muted)]">Ставка, виртуальный TON</label><div className="mt-1 flex items-center border-b border-[var(--border)]"><input value={bet} onChange={(e)=>setBet(e.target.value)} inputMode="decimal" className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none"/><span className="text-xs text-[var(--muted)]">TON</span></div><div className="mxm-hscroll mt-2 gap-4 pb-1">{[1,5,10,25,50,100].map((v)=><button key={v} onClick={()=>setBet(String(Math.min(v,data?.availableBalance||v)))} className="shrink-0 text-[10px] text-[var(--muted)] hover:text-white">{v}</button>)}</div></div>

        {game==="coinflip"?<div className="mt-5 grid grid-cols-2 border-y border-[var(--border-soft)]"><Choice active={choice==="heads"} onClick={()=>setChoice("heads")}>Орёл</Choice><Choice active={choice==="tails"} onClick={()=>setChoice("tails")}>Решка</Choice></div>:null}
        {game==="dice"?<div className="mt-5 grid grid-cols-2 border-y border-[var(--border-soft)]"><Choice active={choice==="low"} onClick={()=>setChoice("low")}>1–49</Choice><Choice active={choice==="high"} onClick={()=>setChoice("high")}>52–100</Choice></div>:null}
        {game==="wheel"?<div className="mt-5 grid grid-cols-5 gap-2 border-y border-[var(--border-soft)] py-3 text-center text-[10px]"><Odds label="x0" chance="50%"/><Odds label="x1.2" chance="25%"/><Odds label="x1.8" chance="15%"/><Odds label="x3" chance="8%"/><Odds label="x8" chance="2%"/></div>:null}

        {last?<div className={`mt-4 border-l-2 px-3 py-2 ${last.multiplier>0?"border-[var(--positive)]":"border-[var(--negative)]"}`}><p className="text-xs font-semibold">{last.multiplier>0?`Выигрыш · x${last.multiplier}`:"Не повезло"}</p><p className="mt-1 text-[10px] text-[var(--muted)]">Результат: {last.result} · Выплата {money(last.payout)}</p></div>:null}
        {error?<p className="mt-3 border-l-2 border-[var(--negative)] px-2 text-[10px] text-[#ff9aa4]">{error}</p>:null}
        <PrimaryButton onClick={play} disabled={!canPlay} className="mt-4 w-full py-3">{busy?"Результат…":"Играть"}</PrimaryButton>
      </section>

      <aside><div className="border-b border-[var(--border-soft)] pb-2 text-xs font-medium">Последние раунды</div>{recent.length?<div className="divide-y divide-[var(--border-soft)]">{recent.slice(0,10).map((r)=><div key={r.id} className="flex items-center justify-between gap-3 py-2.5"><div><p className="text-[10px]">{r.game==="coinflip"?"Монета":r.game==="dice"?"Кубик":"Колесо"}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">{money(r.bet)} · {r.result}</p></div><span className={`text-[10px] font-medium ${r.multiplier>0?"text-[var(--positive)]":"text-[var(--muted)]"}`}>x{r.multiplier}</span></div>)}</div>:<p className="py-6 text-center text-[10px] text-[var(--muted)]">Раундов пока нет</p>}</aside>
    </div>
  </div>;
}
function Choice({active,onClick,children}:{active:boolean;onClick:()=>void;children:React.ReactNode}){return <button onClick={onClick} className={`py-3 text-xs font-semibold ${active?"text-white":"text-[var(--muted)]"}`}>{active?<span className="border-b border-white pb-1">{children}</span>:children}</button>}
function Odds({label,chance}:{label:string;chance:string}){return <div><p className="font-semibold">{label}</p><p className="mt-1 text-[9px] text-[var(--muted)]">{chance}</p></div>}
