"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket, WalletCards } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import { PrimaryButton, SectionTitle } from "@/components/ui";
import { useTelegramProfile } from "@/components/telegram-provider";

const LAUNCH_FEE = 50;

export default function CreatePage() {
  const router = useRouter();
  const { profile, refreshProfile, haptic } = useTelegramProfile();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!profile || profile.availableBalance < LAUNCH_FEE) return;
    setBusy(true); setError(null); haptic("medium");
    try {
      const result = await apiFetch<{ coin: { id: string } }>("/api/coins", { method: "POST", body: JSON.stringify({ name, symbol, description }) });
      await refreshProfile();
      router.push(`/coin/${result.coin.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось создать коин"); }
    finally { setBusy(false); }
  }

  const canLaunch = Boolean(profile && profile.availableBalance >= LAUNCH_FEE && name.trim().length >= 2 && symbol.length >= 2 && !busy);

  return (
    <div className="mx-auto max-w-xl">
      <SectionTitle title="Запуск коина" subtitle="Создайте мемкоин, которым будут торговать игроки." />
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3 md:p-4">
        <div className="grid gap-4">
          <Field label="Название"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Грустный Кот" className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs outline-none focus:border-[#565a61]" /></Field>
          <Field label="Тикер"><div className="flex rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3"><span className="py-2.5 text-[var(--muted)]">$</span><input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0,8))} placeholder="CAT" className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-xs outline-none" /></div></Field>
          <Field label="Описание"><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={180} rows={4} placeholder="Кот, переживший каждую красную свечу." className="mt-2 w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs outline-none focus:border-[#565a61]" /><span className="mt-1 block text-right text-[10px] text-[var(--muted)]">{description.length}/180</span></Field>
        </div>

        <div className="mt-4 rounded-2xl bg-[var(--panel-2)] p-3 text-xs"><Row name="Стоимость запуска" value="$50" /><Row name="Стартовая капитализация" value="$100" /><Row name="Эмиссия" value="1,000,000,000" /><Row name="Механика" value="AMM с постоянным произведением" /></div>
        {profile ? <div className="mt-2 flex items-center justify-between rounded-2xl border border-[var(--border)] px-3 py-2.5 text-xs"><span className="flex items-center gap-2 text-[var(--muted)]"><WalletCards size={14} />Доступный баланс</span><span className={profile.availableBalance < LAUNCH_FEE ? "text-[var(--negative)]" : ""}>{money(profile.availableBalance)}</span></div> : null}
        {profile?.reservedBalance ? <p className="mt-1.5 text-[10px] text-[var(--muted-2)]">{money(profile.reservedBalance)} зарезервировано открытыми офферами и недоступно для запуска.</p> : null}
        {error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}
        <PrimaryButton onClick={create} disabled={!canLaunch} className="mt-4 flex w-full items-center justify-center gap-2 py-3"><Rocket size={17} />{busy ? "Запуск…" : profile && profile.availableBalance < LAUNCH_FEE ? "Нужно $50 доступного баланса" : "Запустить коин"}</PrimaryButton>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="text-xs text-[#c8cbd0]">{label}</span>{children}</label>; }
function Row({ name, value }: { name: string; value: string }) { return <div className="mb-2 flex justify-between gap-3 last:mb-0"><span className="text-[var(--muted)]">{name}</span><span>{value}</span></div>; }
