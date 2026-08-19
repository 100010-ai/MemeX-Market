"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Rocket, ShieldCheck, Sparkles, Upload, WalletCards, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import { CoinAvatar, PrimaryButton } from "@/components/ui";
import { useTelegramProfile } from "@/components/telegram-provider";
import { prepareCoinImage } from "@/lib/client-image";
import { COIN_LAUNCH_FEE_TON } from "@/lib/economy";

const MAX_IMAGE = 2 * 1024 * 1024;
const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp"]);
type Rules = { launchFee:number; cooldownHours:number; maxActiveCoins:number; activeCoins:number; nextLaunchAt:string|null };

export default function CreatePage() {
  const router = useRouter();
  const { profile, refreshProfile, haptic } = useTelegramProfile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rules, setRules] = useState<Rules>({ launchFee: COIN_LAUNCH_FEE_TON, cooldownHours: 12, maxActiveCoins: 3, activeCoins: 0, nextLaunchAt: null });
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void apiFetch<Rules>("/api/coins").then(setRules).catch(() => undefined); }, []);
  useEffect(() => {
    if (!image) { setPreview(null); return; }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setError(null);
    if (!file) { setImage(null); return; }
    if (!ACCEPTED.has(file.type)) { setError("Поддерживаются только PNG, JPG и WebP."); event.target.value = ""; return; }
    if (file.size > MAX_IMAGE) { setError("Изображение должно быть меньше 2 МБ."); event.target.value = ""; return; }
    setImageBusy(true);
    try { setImage(await prepareCoinImage(file)); }
    catch (cause) { setImage(null); event.target.value = ""; setError(cause instanceof Error ? cause.message : "Не удалось обработать изображение."); }
    finally { setImageBusy(false); }
  }

  const cooldownActive = Boolean(rules.nextLaunchAt && new Date(rules.nextLaunchAt).getTime() > Date.now());
  const hasSlot = rules.activeCoins < rules.maxActiveCoins;
  const hasBalance = Boolean(profile && profile.availableBalance >= rules.launchFee);
  const canLaunch = Boolean(profile && hasBalance && hasSlot && !cooldownActive && name.trim().length >= 2 && symbol.length >= 2 && !busy && !imageBusy);

  async function create() {
    if (!canLaunch) return;
    setBusy(true); setError(null); haptic("medium");
    try {
      const form = new FormData();
      form.set("name", name.trim());
      form.set("symbol", symbol.trim());
      form.set("description", description.trim());
      if (image) form.set("image", image);
      const result = await apiFetch<{ coin: { id: string } }>("/api/coins", { method: "POST", body: form });
      sessionStorage.setItem("mxm-market-dirty", "1");
      await refreshProfile();
      router.push(`/coin/${result.coin.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать мемкоин"); }
    finally { setBusy(false); }
  }

  const blocker = !hasSlot ? `Достигнут лимит: ${rules.maxActiveCoins} активных коина` : cooldownActive ? `Следующий запуск: ${new Date(rules.nextLaunchAt!).toLocaleString("ru-RU", { hour:"2-digit", minute:"2-digit", day:"2-digit", month:"2-digit" })}` : !hasBalance ? `Нужно ${money(rules.launchFee)} доступного баланса` : null;

  return (
    <div className="mx-auto max-w-xl mxm-page-enter">
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--border-soft)] pb-3">
        <div><h1 className="text-[17px] font-semibold tracking-[-.02em]">Создать мемкоин</h1><p className="mt-1 text-[11px] text-[var(--muted)]">Стоимость запуска списывается из виртуального TON.</p></div>
        <div className="shrink-0 text-right"><p className="text-[9px] text-[var(--muted)]">Запуск</p><p className="mt-1 text-xs font-semibold">{money(rules.launchFee)}</p></div>
      </div>

      <section>
        <div className="flex items-center gap-3.5 border-b border-[var(--border-soft)] pb-4">
          <button type="button" onClick={() => inputRef.current?.click()} className="group relative grid h-[76px] w-[76px] shrink-0 place-items-center overflow-hidden rounded-[16px] border border-dashed border-[#353a40] transition hover:border-[#555a61] active:scale-[.98]" aria-label="Выбрать изображение мемкоина">
            {preview ? <img src={preview} alt="Предпросмотр" className="h-full w-full object-cover" /> : <div className="text-center text-[var(--muted)]"><ImagePlus size={22} className="mx-auto" /><span className="mt-1 block text-[9px]">Логотип</span></div>}
          </button>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} className="hidden" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Изображение монеты</p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">PNG, JPG или WebP · до 2 МБ. Изображение оптимизируется до 512 px и проверяется сервером.</p>
            <div className="mt-2 flex gap-3"><button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 text-[10px] text-[#cdd1d6]"><Upload size={11} />{imageBusy ? "Обрабатываем…" : "Выбрать"}</button>{image ? <button type="button" onClick={() => { setImage(null); if (inputRef.current) inputRef.current.value = ""; }} className="inline-flex items-center gap-1 text-[10px] text-[var(--muted)]"><X size={11} />Убрать</button> : null}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <Field label="Название" hint={`${name.length}/32`}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Например, Sad Cat" className="mxm-input" /></Field>
          <Field label="Тикер" hint={`${symbol.length}/8`}><div className="mxm-input flex items-center"><span className="text-[var(--muted)]">$</span><input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0,8))} placeholder="CAT" className="min-w-0 flex-1 bg-transparent px-1 outline-none" /></div></Field>
          <Field label="Описание" hint={`${description.length}/180`}><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={180} rows={3} placeholder="Коротко опиши идею мемкоина" className="mxm-input min-h-[84px] resize-none" /></Field>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-y border-[var(--border-soft)] py-3">
          <Info icon={<Sparkles size={12} />} label="Стартовая капитализация" value="100 TON" />
          <Info icon={<ShieldCheck size={12} />} label="Торговля" value="AMM · 0.5%" />
          <Info icon={<Rocket size={12} />} label="Лимит создателя" value={`${rules.activeCoins}/${rules.maxActiveCoins} активных`} />
          <Info icon={<WalletCards size={12} />} label="Доступно" value={profile ? money(profile.availableBalance) : "—"} />
        </div>

        <p className="mt-3 text-[10px] leading-4 text-[var(--muted)]">Можно держать до {rules.maxActiveCoins} активных мемкоинов и запускать новый не чаще одного раза в {rules.cooldownHours} часов.</p>
        {blocker ? <p className="mt-3 border-l-2 border-[var(--accent)] px-2 text-[10px] text-[#d4c596]">{blocker}</p> : null}
        {error ? <p className="mt-3 border-l-2 border-[var(--negative)] px-2 py-1 text-[11px] text-[#ff9aa4]">{error}</p> : null}
        <PrimaryButton onClick={create} disabled={!canLaunch} className="mt-4 flex w-full items-center justify-center gap-2 py-3 text-xs"><Rocket size={16} />{busy ? "Создаём…" : blocker || "Запустить мемкоин"}</PrimaryButton>
      </section>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 flex items-center justify-between text-[11px] text-[#c9cdd2]"><span>{label}</span>{hint ? <span className="text-[9px] text-[var(--muted-2)]">{hint}</span> : null}</span>{children}</label>; }
function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div><div className="flex items-center gap-1.5 text-[9px] text-[var(--muted)]">{icon}{label}</div><p className="mt-1 text-xs font-semibold">{value}</p></div>; }
