"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { PrimaryButton, SectionTitle } from "@/components/ui";
import { useTelegramProfile } from "@/components/telegram-provider";

export default function CreatePage() {
  const router = useRouter();
  const { refreshProfile, haptic } = useTelegramProfile();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true); setError(null); haptic("medium");
    try {
      const result = await apiFetch<{ coin: { id: string } }>("/api/coins", { method: "POST", body: JSON.stringify({ name, symbol, description }) });
      await refreshProfile();
      router.push(`/coin/${result.coin.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create coin"); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-xl"><SectionTitle title="Launch coin" subtitle="Create a player-traded meme coin." /><section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 md:p-4"><div className="grid gap-4"><Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Keyboard Cat" className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 outline-none focus:border-[#565a61]" /></Field><Field label="Ticker"><div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3"><span className="py-3 text-[var(--muted)]">$</span><input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0,8))} placeholder="KCAT" className="min-w-0 flex-1 bg-transparent px-1 py-3 outline-none" /></div></Field><Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={180} rows={4} placeholder="The cat that survived every red candle." className="mt-2 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 outline-none focus:border-[#565a61]" /><span className="mt-1 block text-right text-[10px] text-[var(--muted)]">{description.length}/180</span></Field></div><div className="mt-4 rounded-lg bg-[var(--panel-2)] p-3 text-xs"><Row name="Launch fee" value="$50" /><Row name="Starting market cap" value="$100" /><Row name="Supply" value="1,000,000,000" /><Row name="Curve" value="Constant-product AMM" /></div>{error ? <p className="mt-3 text-xs text-[var(--negative)]">{error}</p> : null}<PrimaryButton onClick={create} disabled={busy || name.trim().length < 2 || symbol.length < 2} className="mt-4 flex w-full items-center justify-center gap-2 py-3"><Rocket size={17} />{busy ? "Launching…" : "Launch coin"}</PrimaryButton></section></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="text-xs text-[#c8cbd0]">{label}</span>{children}</label>; }
function Row({ name, value }: { name: string; value: string }) { return <div className="mb-2 flex justify-between gap-3 last:mb-0"><span className="text-[var(--muted)]">{name}</span><span>{value}</span></div>; }
