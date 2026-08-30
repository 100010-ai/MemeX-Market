import Link from "next/link";
import { ArrowRight, Crown, Gift, Trophy, Zap } from "lucide-react";
import { BattlePassIntel } from "@/components/season/battle-pass-intel";

export default function BattlePassPage() {
  return <div className="mx-auto max-w-4xl">
    <header className="mb-4"><p className="text-[10px] uppercase tracking-[.13em] text-[var(--muted-2)]">MXM Seasons</p><h1 className="mt-1 flex items-center gap-2 text-lg font-semibold"><Crown size={18} />Battle Pass</h1><p className="mt-1 max-w-2xl text-[11px] leading-5 text-[var(--muted)]">Еженедельные сезоны, free/premium дорожки, эксклюзивная косметика и Prestige после основной шкалы.</p></header>
    <BattlePassIntel />
    <section className="grid gap-2 sm:grid-cols-3"><Feature icon={<Zap size={15} />} title="XP из рынка" text="Сделки, подарки, мемкоины и задания двигают одну сезонную шкалу." /><Feature icon={<Gift size={15} />} title="Exclusive rewards" text="Сезонная косметика привязана к конкретной неделе и остаётся коллекционной." /><Feature icon={<Trophy size={15} />} title="Prestige" text="После основной дорожки XP продолжает превращаться в дополнительные награды." /></section>
    <Link href="/season" className="mxm-primary-action mt-4 min-h-12 w-full justify-center text-xs">Открыть дорожку наград <ArrowRight size={14} /></Link>
  </div>;
}
function Feature({icon,title,text}:{icon:React.ReactNode;title:string;text:string}) { return <article className="rounded-[18px] border border-[var(--border)] bg-[var(--panel)] p-3.5"><span className="grid h-8 w-8 place-items-center rounded-[12px] bg-[var(--panel-2)] text-[var(--accent)]">{icon}</span><h2 className="mt-3 text-[11px] font-semibold">{title}</h2><p className="mt-1 text-[9px] leading-4 text-[var(--muted)]">{text}</p></article>; }
