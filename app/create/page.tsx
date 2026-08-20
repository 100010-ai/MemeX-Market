"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImagePlus, Rocket, ShieldCheck, Sparkles, Upload, WalletCards, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import { PrimaryButton } from "@/components/ui";
import { useTelegramProfile } from "@/components/telegram-provider";
import { prepareCoinImage } from "@/lib/client-image";
import { COIN_LAUNCH_COOLDOWN_HOURS, COIN_LAUNCH_FEE_TON, COIN_MAX_ACTIVE_PER_CREATOR, COIN_TRADE_FEE_PERCENT } from "@/lib/economy";

const MAX_IMAGE = 2 * 1024 * 1024;
const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp"]);
type Rules = {
  launchFee:number; cooldownHours:number; maxActiveCoins:number; activeCoins:number; nextLaunchAt:string|null; economyReady:boolean;
  initialBuyMin:number; initialBuyMax:number; startPriceMin:number; startPriceMax:number; floorMaxBps:number;
  energyCost:number; energy:number; maxEnergy:number;
};

function makeLaunchRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (digit) =>
    (Number(digit) ^ (globalThis.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(digit) / 4)))).toString(16));
}

export default function CreatePage() {
  const router = useRouter();
  const { profile, refreshProfile, haptic } = useTelegramProfile();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [initialBuy, setInitialBuy] = useState("10");
  const [startPrice, setStartPrice] = useState("0.0000001");
  const [floorPrice, setFloorPrice] = useState("0.00000005");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rules, setRules] = useState<Rules>({ launchFee: COIN_LAUNCH_FEE_TON, cooldownHours: COIN_LAUNCH_COOLDOWN_HOURS, maxActiveCoins: COIN_MAX_ACTIVE_PER_CREATOR, activeCoins: 0, nextLaunchAt: null, economyReady: false, initialBuyMin: 1, initialBuyMax: 1_000, startPriceMin: 0.00000001, startPriceMax: 0.000001, floorMaxBps: 5_000, energyCost: 20, energy: 0, maxEnergy: 100 });
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const launchRequestId = useRef<string | null>(null);

  useEffect(() => {
    void apiFetch<Rules>("/api/coins", { cacheMs: 0 })
      .then(setRules)
      .catch(() => setError("Не удалось загрузить параметры запуска"))
      .finally(() => setRulesLoaded(true));
  }, []);
  useEffect(() => {
    if (!rules.nextLaunchAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [rules.nextLaunchAt]);
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);
  useEffect(() => { launchRequestId.current = null; }, [name, symbol, description, image, initialBuy, startPrice, floorPrice]);

  function replaceImage(nextImage: File | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const nextPreview = nextImage ? URL.createObjectURL(nextImage) : null;
    previewUrlRef.current = nextPreview;
    setImage(nextImage);
    setPreview(nextPreview);
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setError(null);
    if (!file) { replaceImage(null); return; }
    if (!ACCEPTED.has(file.type)) { setError("Поддерживаются только PNG, JPG и WebP."); event.target.value = ""; return; }
    if (file.size > MAX_IMAGE) { setError("Изображение должно быть меньше 2 МБ."); event.target.value = ""; return; }
    setImageBusy(true);
    try { replaceImage(await prepareCoinImage(file)); }
    catch (cause) { replaceImage(null); event.target.value = ""; setError(cause instanceof Error ? cause.message : "Не удалось обработать изображение."); }
    finally { setImageBusy(false); }
  }

  const cooldownActive = Boolean(rules.nextLaunchAt && new Date(rules.nextLaunchAt).getTime() > now);
  const hasSlot = rules.activeCoins < rules.maxActiveCoins;
  const initialBuyValue = Number(initialBuy);
  const startPriceValue = Number(startPrice);
  const floorPriceValue = Number(floorPrice);
  const validEconomy = Number.isFinite(initialBuyValue) && initialBuyValue >= rules.initialBuyMin && initialBuyValue <= rules.initialBuyMax
    && Number.isFinite(startPriceValue) && startPriceValue >= rules.startPriceMin && startPriceValue <= rules.startPriceMax
    && Number.isFinite(floorPriceValue) && floorPriceValue >= 0 && floorPriceValue <= startPriceValue * rules.floorMaxBps / 10_000;
  const hasBalance = Boolean(profile && profile.availableBalance >= rules.launchFee + (Number.isFinite(initialBuyValue) ? initialBuyValue : 0));
  const hasEnergy = rules.energy >= rules.energyCost;
  const canLaunch = Boolean(rulesLoaded && rules.economyReady && profile && validEconomy && hasBalance && hasEnergy && hasSlot && !cooldownActive && name.trim().length >= 2 && symbol.length >= 2 && !busy && !imageBusy);

  async function create() {
    if (!canLaunch) return;
    setBusy(true); setError(null); haptic("medium");
    try {
      const form = new FormData();
      form.set("name", name.trim());
      form.set("symbol", symbol.trim());
      form.set("description", description.trim());
      form.set("requestId", launchRequestId.current || (launchRequestId.current = makeLaunchRequestId()));
      form.set("initialBuy", initialBuy);
      form.set("startPrice", startPrice);
      form.set("floorPrice", floorPrice);
      if (image) form.set("image", image);
      const result = await apiFetch<{ coin: { id: string } }>("/api/coins", { method: "POST", body: form });
      sessionStorage.setItem("mxm-market-dirty", "1");
      await refreshProfile();
      router.push(`/coin/${result.coin.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать мемкоин"); }
    finally { setBusy(false); }
  }

  const blocker = !rulesLoaded ? "Проверяем правила запуска…" : !rules.economyReady ? "Примените Market Economy 2.0" : !validEconomy ? "Проверьте первичную покупку, стартовую цену и floor" : !hasSlot ? `Достигнут лимит: ${rules.maxActiveCoins} активных коина` : cooldownActive ? `Следующий запуск: ${new Date(rules.nextLaunchAt!).toLocaleString("ru-RU", { hour:"2-digit", minute:"2-digit", day:"2-digit", month:"2-digit" })}` : !hasEnergy ? `Нужно ${rules.energyCost} Energy · доступно ${rules.energy}` : !hasBalance ? `Нужно ${money(rules.launchFee + initialBuyValue)} доступного баланса` : null;

  return (
    <div className="mx-auto max-w-xl mxm-page-enter">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--border-soft)] pb-2.5">
        <h1 className="text-sm font-semibold tracking-[-.02em]">Новый мемкоин</h1>
        <div className="shrink-0 text-right"><p className="text-[9px] text-[var(--muted)]">Комиссия запуска</p><p className="mt-1 text-xs font-semibold">{money(rules.launchFee)}</p></div>
      </div>

      <section>
        <div className="flex items-center gap-3.5 border-b border-[var(--border-soft)] pb-4">
          <button type="button" onClick={() => inputRef.current?.click()} className="group relative grid h-[76px] w-[76px] shrink-0 place-items-center overflow-hidden rounded-[16px] border border-dashed border-[#353a40] transition hover:border-[#555a61] active:scale-[.98]" aria-label="Выбрать изображение мемкоина">
            {preview ? <Image src={preview} alt="Предпросмотр" fill unoptimized sizes="76px" className="object-cover" /> : <div className="text-center text-[var(--muted)]"><ImagePlus size={22} className="mx-auto" /><span className="mt-1 block text-[9px]">Логотип</span></div>}
          </button>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} className="hidden" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium">Логотип</p>
            <p className="mt-1 text-[9px] text-[var(--muted)]">PNG/JPG/WebP · до 2 МБ</p>
            <div className="mt-2 flex gap-3"><button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 text-[10px] text-[#cdd1d6]"><Upload size={11} />{imageBusy ? "Обрабатываем…" : "Выбрать"}</button>{image ? <button type="button" onClick={() => { replaceImage(null); if (inputRef.current) inputRef.current.value = ""; }} className="inline-flex items-center gap-1 text-[10px] text-[var(--muted)]"><X size={11} />Убрать</button> : null}</div>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <Field label="Название" hint={`${name.length}/32`}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Например, Sad Cat" className="mxm-input" /></Field>
          <Field label="Тикер" hint={`${symbol.length}/8`}><div className="mxm-input flex items-center"><span className="text-[var(--muted)]">$</span><input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0,8))} placeholder="CAT" className="min-w-0 flex-1 bg-transparent px-1 outline-none" /></div></Field>
          <Field label="Описание" hint={`${description.length}/180`}><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={180} rows={3} placeholder="Идея мемкоина" className="mxm-input min-h-[84px] resize-none" /></Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Первичная покупка" hint={`${rules.initialBuyMin}–${rules.initialBuyMax} TON`}><input value={initialBuy} onChange={(e) => setInitialBuy(e.target.value)} inputMode="decimal" className="mxm-input" /></Field>
            <Field label="Стартовая цена" hint={`${rules.startPriceMin}–${rules.startPriceMax}`}><input value={startPrice} onChange={(e) => setStartPrice(e.target.value)} inputMode="decimal" className="mxm-input" /></Field>
            <Field label="Floor на 30 дней" hint={`≤ ${rules.floorMaxBps / 100}% старта`}><input value={floorPrice} onChange={(e) => setFloorPrice(e.target.value)} inputMode="decimal" className="mxm-input" /></Field>
          </div>
          <p className="text-[9px] leading-4 text-[var(--muted-2)]">50% токенов первичной покупки линейно разблокируются за 30 дней. Floor действует только в стартовый 30-дневный период.</p>
        </div>

        <div className="mt-4 border-y border-[var(--border-soft)] py-3">
          <div className="grid grid-cols-2 gap-x-5 gap-y-3">
            <Info icon={<Sparkles size={12} />} label="Начальная капитализация" value={Number.isFinite(startPriceValue) ? money(startPriceValue * 1_000_000_000) : "—"} />
            <Info icon={<ShieldCheck size={12} />} label="Ликвидность AMM" value={Number.isFinite(startPriceValue) ? money(startPriceValue * 1_000_000_000) : "—"} />
            <Info icon={<Rocket size={12} />} label="Комиссия сделки" value={`${COIN_TRADE_FEE_PERCENT.toLocaleString("ru-RU")}%`} />
            <Info icon={<WalletCards size={12} />} label="Доступный баланс" value={profile ? money(profile.availableBalance) : "—"} />
            <Info icon={<Sparkles size={12} />} label="Energy запуска" value={`${rules.energyCost} · доступно ${rules.energy}/${rules.maxEnergy}`} />
          </div>
          <p className="mt-3 text-[9px] leading-4 text-[var(--muted-2)]">Все значения внутри MXM виртуальные. Здесь нет депозита, вывода или обещания реальной стоимости TON.</p>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-[9px] text-[var(--muted)]"><span>Активных мемкоинов: {rules.activeCoins}/{rules.maxActiveCoins}</span><span>Пауза между запусками: {rules.cooldownHours} ч</span></div>

        {blocker ? <p className="mt-3 border-l-2 border-[var(--accent)] px-2 text-[10px] text-[#d4c596]">{blocker}</p> : null}
        {error ? <p className="mt-3 border-l-2 border-[var(--negative)] px-2 py-1 text-[11px] text-[#ff9aa4]">{error}</p> : null}
        <PrimaryButton onClick={create} disabled={!canLaunch} className="mt-4 flex w-full items-center justify-center gap-2 py-3 text-xs"><Rocket size={16} />{busy ? "Создаём…" : blocker || "Запустить мемкоин"}</PrimaryButton>
      </section>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 flex items-center justify-between text-[11px] text-[#c9cdd2]"><span>{label}</span>{hint ? <span className="text-[9px] text-[var(--muted-2)]">{hint}</span> : null}</span>{children}</label>; }
function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div><div className="flex items-center gap-1.5 text-[9px] text-[var(--muted)]">{icon}{label}</div><p className="mt-1 text-xs font-semibold">{value}</p></div>; }
