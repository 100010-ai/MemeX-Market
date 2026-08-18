"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Rocket, ShieldCheck, Sparkles, Upload, WalletCards, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import { CoinAvatar, PrimaryButton } from "@/components/ui";
import { useTelegramProfile } from "@/components/telegram-provider";
import { prepareCoinImage } from "@/lib/client-image";

const LAUNCH_FEE = 50;
const MAX_IMAGE = 2 * 1024 * 1024;
const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp"]);

export default function CreatePage() {
  const router = useRouter();
  const { profile, refreshProfile, haptic } = useTelegramProfile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
      setImage(await prepareCoinImage(file));
    } catch (cause) {
      setImage(null);
      event.target.value = "";
      setError(cause instanceof Error ? cause.message : "Не удалось обработать изображение.");
    } finally {
      setImageBusy(false);
    }
  }

  async function create() {
    if (!profile || profile.availableBalance < LAUNCH_FEE) return;
    setBusy(true); setError(null); haptic("medium");
    try {
      const form = new FormData();
      form.set("name", name.trim());
      form.set("symbol", symbol.trim());
      form.set("description", description.trim());
      if (image) form.set("image", image);
      const result = await apiFetch<{ coin: { id: string } }>("/api/coins", { method: "POST", body: form });
      await refreshProfile();
      router.push(`/coin/${result.coin.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать мемкоин");
    } finally { setBusy(false); }
  }

  const canLaunch = Boolean(profile && profile.availableBalance >= LAUNCH_FEE && name.trim().length >= 2 && symbol.length >= 2 && !busy && !imageBusy);

  return (
    <div className="mx-auto max-w-xl mxm-page-enter">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div><h1 className="text-[17px] font-semibold tracking-[-.02em]">Создать мемкоин</h1><p className="mt-1 text-[11px] text-[var(--muted)]">Свой логотип, тикер и описание. Торговля запускается сразу после создания.</p></div>
        <div className="rounded-[15px] border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5 text-[10px] text-[var(--muted)]">Комиссия {money(LAUNCH_FEE)}</div>
      </div>

      <section className="mxm-card p-3.5 md:p-4">
        <div className="flex items-center gap-3.5">
          <button type="button" onClick={() => inputRef.current?.click()} className="group relative grid h-[84px] w-[84px] shrink-0 place-items-center overflow-hidden rounded-[24px] border border-dashed border-[#353a40] bg-[var(--surface)] transition hover:border-[#555a61] active:scale-[.98]" aria-label="Выбрать изображение мемкоина">
            {preview ? <img src={preview} alt="Предпросмотр" className="h-full w-full object-cover" /> : <div className="text-center text-[var(--muted)]"><ImagePlus size={22} className="mx-auto" /><span className="mt-1 block text-[9px]">Логотип</span></div>}
            {preview ? <span className="absolute inset-x-1.5 bottom-1.5 rounded-xl bg-black/55 py-1 text-[8px] text-white/85 backdrop-blur">Заменить</span> : null}
          </button>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} className="hidden" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Изображение монеты</p>
            <p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">PNG, JPG или WebP · до 2 МБ. Перед отправкой логотип уменьшается до 512 px, затем сервер проверяет файл и сохраняет его в Supabase Storage.</p>
            <div className="mt-2 flex gap-1.5">
              <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-[14px] bg-[var(--panel-2)] px-2.5 py-1.5 text-[10px]"><Upload size={11} />{imageBusy ? "Обрабатываем…" : "Выбрать"}</button>
              {image ? <button type="button" onClick={() => { setImage(null); if (inputRef.current) inputRef.current.value = ""; }} className="inline-flex items-center gap-1 rounded-[14px] px-2 py-1.5 text-[10px] text-[var(--muted)]"><X size={11} />Убрать</button> : null}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <Field label="Название" hint={`${name.length}/32`}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Например, Sad Cat" className="mxm-input" /></Field>
          <Field label="Тикер" hint={`${symbol.length}/8`}><div className="mxm-input flex items-center"><span className="text-[var(--muted)]">$</span><input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0,8))} placeholder="CAT" className="min-w-0 flex-1 bg-transparent px-1 outline-none" /></div></Field>
          <Field label="Описание" hint={`${description.length}/180`}><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={180} rows={3} placeholder="Коротко опиши идею мемкоина" className="mxm-input min-h-[84px] resize-none" /></Field>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Info icon={<Sparkles size={13} />} label="Стартовая капитализация" value="100 TON" />
          <Info icon={<ShieldCheck size={13} />} label="Торговая механика" value="AMM" />
        </div>
        <div className="mt-2 rounded-[18px] border border-[var(--border-soft)] bg-[var(--surface)] p-3 text-[10px] leading-4 text-[var(--muted)]">Цена и свечи не генерируются. После запуска график меняется только от реальных виртуальных сделок игроков внутри MXM.</div>

        {profile ? <div className="mt-3 flex items-center justify-between rounded-[18px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-xs"><span className="flex items-center gap-2 text-[var(--muted)]"><WalletCards size={14} />Доступно</span><span className={profile.availableBalance < LAUNCH_FEE ? "text-[var(--negative)]" : "font-medium"}>{money(profile.availableBalance)}</span></div> : null}
        {error ? <p className="mt-3 rounded-[16px] border border-[#512d32] bg-[#211518] px-3 py-2.5 text-[11px] text-[#ff9aa4]">{error}</p> : null}
        <PrimaryButton onClick={create} disabled={!canLaunch} className="mt-3 flex w-full items-center justify-center gap-2 py-3 text-xs"><Rocket size={16} />{busy ? "Создаём…" : profile && profile.availableBalance < LAUNCH_FEE ? "Недостаточно доступного баланса" : "Запустить мемкоин"}</PrimaryButton>
      </section>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 flex items-center justify-between text-[11px] text-[#c9cdd2]"><span>{label}</span>{hint ? <span className="text-[9px] text-[var(--muted-2)]">{hint}</span> : null}</span>{children}</label>;
}
function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--panel-2)] p-2.5"><div className="flex items-center gap-1.5 text-[9px] text-[var(--muted)]">{icon}{label}</div><p className="mt-1.5 text-xs font-semibold">{value}</p></div>; }
