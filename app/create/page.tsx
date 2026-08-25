"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, BadgeCheck, Check, Circle, Coins, ImagePlus, LockKeyhole, Rocket, Sparkles, Upload, WalletCards, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import { PrimaryButton } from "@/components/ui";
import { useTelegramProfile } from "@/components/telegram-provider";
import { prepareCoinImage } from "@/lib/client-image";
import { COIN_LAUNCH_COOLDOWN_HOURS, COIN_LAUNCH_FEE_TON, COIN_MAX_ACTIVE_PER_CREATOR, COIN_TRADE_FEE_PERCENT, parseEconomyAmount } from "@/lib/economy";

const MAX_IMAGE = 2 * 1024 * 1024;
const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp"]);
const MARKET_UI_STATE_KEY = "mxm-market-ui-v0642";
type Rules = {
  launchFee:number; cooldownHours:number; maxActiveCoins:number; activeCoins:number; nextLaunchAt:string|null; economyReady:boolean;
  initialBuyMin:number; initialBuyMax:number; startPriceMin:number; startPriceMax:number; floorMaxBps:number;
  creatorLockBps:number; creatorLockDays:number;
  energyCost:number; energy:number; maxEnergy:number; tradeFeePercent:number;
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
  const [rules, setRules] = useState<Rules>({ launchFee: COIN_LAUNCH_FEE_TON, cooldownHours: COIN_LAUNCH_COOLDOWN_HOURS, maxActiveCoins: COIN_MAX_ACTIVE_PER_CREATOR, activeCoins: 0, nextLaunchAt: null, economyReady: false, initialBuyMin: 1, initialBuyMax: 1_000, startPriceMin: 0.00000001, startPriceMax: 0.000001, floorMaxBps: 5_000, creatorLockBps: 5_000, creatorLockDays: 30, energyCost: 20, energy: 0, maxEnergy: 100, tradeFeePercent: COIN_TRADE_FEE_PERCENT });
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const launchRequestId = useRef<string | null>(null);

  useEffect(() => {
    void apiFetch<Rules>("/api/coins", { cacheMs: 15_000 })
      .then((next) => setRules({
        ...next,
        tradeFeePercent: Number.isFinite(next.tradeFeePercent) ? next.tradeFeePercent : COIN_TRADE_FEE_PERCENT,
        creatorLockBps: Number.isFinite(next.creatorLockBps) ? next.creatorLockBps : 5_000,
        creatorLockDays: Number.isFinite(next.creatorLockDays) ? next.creatorLockDays : 30,
      }))
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
  const parsedInitialBuy = parseEconomyAmount(initialBuy);
  const parsedStartPrice = parseEconomyAmount(startPrice);
  const parsedFloorPrice = parseEconomyAmount(floorPrice);
  const initialBuyValue = parsedInitialBuy ?? Number.NaN;
  const startPriceValue = parsedStartPrice ?? Number.NaN;
  const floorPriceValue = parsedFloorPrice ?? Number.NaN;
  const validEconomy = parsedInitialBuy != null && initialBuyValue >= rules.initialBuyMin && initialBuyValue <= rules.initialBuyMax
    && parsedStartPrice != null && startPriceValue >= rules.startPriceMin && startPriceValue <= rules.startPriceMax
    && parsedFloorPrice != null && floorPriceValue >= 0 && floorPriceValue <= startPriceValue * rules.floorMaxBps / 10_000;
  const hasBalance = Boolean(profile && profile.availableBalance >= rules.launchFee + (parsedInitialBuy ?? 0));
  const hasEnergy = rules.energy >= rules.energyCost;
  const launchPreview = (() => {
    if (parsedInitialBuy == null || parsedStartPrice == null || initialBuyValue <= 0 || startPriceValue <= 0) return null;
    const supply = 1_000_000_000;
    const initialQuoteReserve = supply * startPriceValue;
    const initialTokenReserve = supply;
    const fee = Number((initialBuyValue * rules.tradeFeePercent / 100).toFixed(8));
    const netSeed = initialBuyValue - fee;
    if (netSeed <= 0) return null;
    const invariant = initialTokenReserve * initialQuoteReserve;
    const quoteReserve = initialQuoteReserve + netSeed;
    const tokenReserve = invariant / quoteReserve;
    const openingPrice = quoteReserve / tokenReserve;
    return { openingPrice, marketCap: openingPrice * supply, liquidity: quoteReserve * 2 };
  })();
  const canLaunch = Boolean(rulesLoaded && rules.economyReady && profile && validEconomy && hasBalance && hasEnergy && hasSlot && !cooldownActive && name.trim().length >= 2 && symbol.length >= 2 && !busy && !imageBusy);
  const identityReady = name.trim().length >= 2 && symbol.length >= 2;
  const accountReady = Boolean(profile && hasBalance && hasEnergy && hasSlot && !cooldownActive);
  const launchBudget = rules.launchFee + (parsedInitialBuy ?? 0);

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
      try {
        const saved = JSON.parse(sessionStorage.getItem(MARKET_UI_STATE_KEY) || "{}") as Record<string, unknown>;
        sessionStorage.setItem(MARKET_UI_STATE_KEY, JSON.stringify({ ...saved, tab: "coins", coinSort: "newest", query: "", watchOnly: false, scrollY: 0 }));
      } catch {
        sessionStorage.setItem(MARKET_UI_STATE_KEY, JSON.stringify({ tab: "coins", coinSort: "newest", query: "", watchOnly: false, scrollY: 0 }));
      }
      await refreshProfile();
      router.push(`/coin/${result.coin.id}?created=1`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать мемкоин"); }
    finally { setBusy(false); }
  }

  const blocker = !rulesLoaded ? "Проверяем правила запуска…" : !rules.economyReady ? "Экономика рынка ещё не готова" : !validEconomy ? "Проверьте стартовую позицию и цены" : !hasSlot ? `Достигнут лимит: ${rules.maxActiveCoins} активных мемкоинов` : cooldownActive ? `Следующий запуск: ${new Date(rules.nextLaunchAt!).toLocaleString("ru-RU", { hour:"2-digit", minute:"2-digit", day:"2-digit", month:"2-digit" })}` : !hasEnergy ? `Нужно ${rules.energyCost} энергии · доступно ${rules.energy}` : !hasBalance ? `Нужно ${money(rules.launchFee + (parsedInitialBuy ?? 0))} доступного баланса` : null;

  return (
    <div className="mx-auto max-w-6xl mxm-page-enter">
      <header className="mxm-compact-page-head">
        <div className="min-w-0">
          <Link href="/market?tab=coins" className="mxm-compact-link"><ArrowLeft size={12} />Мемкоины</Link>
          <h1 className="mxm-page-title mt-1">Запуск нового рынка</h1>
        </div>
        <span className={`mxm-studio-status ${canLaunch ? "is-ready" : ""}`}><span />{canLaunch ? "Готов к запуску" : "Черновик"}</span>
      </header>

      <div className="mxm-launch-studio">
        <div className="min-w-0 space-y-3">
          <section className="mxm-launch-section">
            <SectionHead step="01" title="Идентичность" ready={identityReady} />
            <div className="mxm-launch-section-body">
              <div className="flex items-center gap-3.5 border-b border-[var(--border-soft)] pb-4">
                <button type="button" onClick={() => inputRef.current?.click()} className="mxm-launch-upload" aria-label="Выбрать изображение мемкоина">
                  {preview ? <Image src={preview} alt="Предпросмотр логотипа" fill unoptimized sizes="82px" className="object-cover" /> : <div className="text-center text-[var(--muted)]"><ImagePlus size={22} className="mx-auto" /><span className="mt-1 block text-[8px]">Логотип</span></div>}
                </button>
                <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} className="hidden" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium">Визуальный знак</p>
                  <p className="mt-1 text-[9px] leading-4 text-[var(--muted)]">PNG, JPG или WebP · до 2 МБ</p>
                  <div className="mt-2 flex gap-4"><button type="button" onClick={() => inputRef.current?.click()} className="inline-flex min-h-7 items-center gap-1.5 text-[9px] text-[#cdd1d6]"><Upload size={11} />{imageBusy ? "Обрабатываем…" : image ? "Заменить" : "Выбрать"}</button>{image ? <button type="button" onClick={() => { replaceImage(null); if (inputRef.current) inputRef.current.value = ""; }} className="inline-flex min-h-7 items-center gap-1 text-[9px] text-[var(--muted)]"><X size={11} />Убрать</button> : null}</div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Название" hint={`${name.length}/32`}><input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} autoComplete="off" placeholder="Например, Sad Cat" className="mxm-input" /></Field>
                <Field label="Тикер" hint={`${symbol.length}/8`}><div className="mxm-input flex items-center"><span className="text-[var(--muted)]">$</span><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0,8))} maxLength={8} autoCapitalize="characters" autoComplete="off" placeholder="CAT" className="min-w-0 flex-1 bg-transparent px-1 outline-none" /></div></Field>
                <div className="sm:col-span-2"><Field label="Описание" hint={`${description.length}/180`}><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={180} rows={3} placeholder="Коротко объясните идею мемкоина" className="mxm-input min-h-[82px] resize-none" /></Field></div>
              </div>
            </div>
          </section>

          <section className="mxm-launch-section">
            <SectionHead step="02" title="Экономика старта" ready={validEconomy} />
            <div className="mxm-launch-section-body">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Первичная покупка" hint={`${rules.initialBuyMin}–${rules.initialBuyMax} TON`}><div className="mxm-input flex items-center gap-2"><input value={initialBuy} onChange={(event) => setInitialBuy(event.target.value)} inputMode="decimal" aria-label="Первичная покупка в TON" className="min-w-0 flex-1 bg-transparent outline-none" /><span className="text-[9px] text-[var(--muted)]">TON</span></div></Field>
                <Field label="Стартовая цена" hint={`${rules.startPriceMin}–${rules.startPriceMax}`}><input value={startPrice} onChange={(event) => setStartPrice(event.target.value)} inputMode="decimal" aria-label="Стартовая цена" className="mxm-input" /></Field>
                <Field label={`Floor на ${rules.creatorLockDays} дней`} hint={`≤ ${rules.floorMaxBps / 100}% старта`}><input value={floorPrice} onChange={(event) => setFloorPrice(event.target.value)} inputMode="decimal" aria-label="Минимальная цена" className="mxm-input" /></Field>
              </div>
              <div className="mxm-launch-policy mt-3"><LockKeyhole size={13} /><p><strong>{rules.creatorLockBps / 100}% позиции</strong> · линейный unlock {rules.creatorLockDays} дней · floor на стартовый период</p></div>
            </div>
          </section>
        </div>

        <aside className="mxm-launch-sidebar">
          <section className="mxm-launch-preview-card">
            <div className="flex items-center gap-3">
              <div className="mxm-launch-preview-logo">{preview ? <Image src={preview} alt="" fill unoptimized sizes="52px" className="object-cover" /> : <Coins size={20} />}</div>
              <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-semibold">{name.trim() || "Название мемкоина"}</p><p className="mt-0.5 text-[9px] text-[var(--muted)]">${symbol || "TICKER"} · новый рынок</p></div>
              <span className="mxm-status-chip">PRE-LAUNCH</span>
            </div>
            <p className="mt-3 line-clamp-3 min-h-10 text-[9px] leading-5 text-[var(--muted)]">{description.trim() || "Описание поможет участникам быстро понять идею рынка."}</p>
            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-[13px] border border-[var(--border-soft)] bg-[var(--border-soft)]">
              <PreviewMetric label="Цена открытия" value={launchPreview ? pricePreview(launchPreview.openingPrice) : "—"} />
              <PreviewMetric label="Капитализация" value={launchPreview ? money(launchPreview.marketCap) : "—"} />
              <PreviewMetric label="Ликвидность" value={launchPreview ? money(launchPreview.liquidity) : "—"} />
              <PreviewMetric label="Комиссия сделки" value={`${rules.tradeFeePercent.toLocaleString("ru-RU")}%`} />
            </div>
          </section>

          <section className="mxm-launch-checklist">
            <div className="mxm-section-head"><span>Проверка запуска</span><span className="text-[8px] text-[var(--muted-2)]">{[identityReady, validEconomy, accountReady].filter(Boolean).length}/3</span></div>
            <LaunchCheck ready={identityReady} label="Карточка рынка" detail={identityReady ? `${name.trim()} · $${symbol}` : "Добавьте название и тикер"} />
            <LaunchCheck ready={validEconomy} label="Экономика" detail={validEconomy ? "Параметры проходят лимиты" : "Проверьте позицию, цену и floor"} />
            <LaunchCheck ready={accountReady} label="Аккаунт" detail={accountReady ? "Баланс, энергия и слот доступны" : blocker || "Проверяем ограничения"} />
          </section>

          <section className="mxm-launch-budget">
            <div className="flex items-center justify-between"><span>Бюджет запуска</span><strong>{Number.isFinite(launchBudget) ? money(launchBudget) : "—"}</strong></div>
            <div className="mt-2 grid grid-cols-2 gap-3"><Info icon={<WalletCards size={12} />} label="Доступно" value={profile ? money(profile.availableBalance) : "—"} /><Info icon={<Sparkles size={12} />} label="Энергия" value={`${rules.energy}/${rules.maxEnergy}`} /></div>
            <div className="mt-3 flex items-center justify-between border-t border-[var(--border-soft)] pt-2 text-[8px] text-[var(--muted)]"><span>Комиссия {money(rules.launchFee)}</span><span>Позиция {parsedInitialBuy == null ? "—" : money(parsedInitialBuy)}</span></div>
          </section>

          {blocker ? <div className="mxm-inline-notice" aria-live="polite">{blocker}</div> : null}
          {error ? <div className="mxm-inline-notice is-error" role="alert">{error}</div> : null}
          <PrimaryButton onClick={create} disabled={!canLaunch} className="flex w-full items-center justify-center gap-2 !min-h-11 text-[11px]"><Rocket size={15} />{busy ? "Создаём рынок…" : "Запустить мемкоин"}</PrimaryButton>
          <p className="px-1 text-center text-[7.5px] leading-4 text-[var(--muted-2)]">Виртуальный рынок MXM, не реальный токен.</p>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 flex items-center justify-between text-[11px] text-[#c9cdd2]"><span>{label}</span>{hint ? <span className="text-[9px] text-[var(--muted-2)]">{hint}</span> : null}</span>{children}</label>; }
function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div><div className="flex items-center gap-1.5 text-[9px] text-[var(--muted)]">{icon}{label}</div><p className="mt-1 text-xs font-semibold">{value}</p></div>; }
function SectionHead({ step, title, ready }: { step: string; title: string; ready: boolean }) { return <header className="mxm-launch-section-head"><span>{step}</span><div className="min-w-0 flex-1"><h2>{title}</h2></div>{ready ? <BadgeCheck size={16} /> : null}</header>; }
function PreviewMetric({ label, value }: { label: string; value: string }) { return <div className="bg-[var(--panel)] px-2.5 py-2"><p className="text-[7px] text-[var(--muted-2)]">{label}</p><p className="mt-1 truncate text-[9px] font-semibold tabular-nums">{value}</p></div>; }
function LaunchCheck({ ready, label, detail }: { ready: boolean; label: string; detail: string }) { return <div className="mxm-launch-check"><span className={ready ? "is-ready" : ""}>{ready ? <Check size={11} /> : <Circle size={10} />}</span><div className="min-w-0"><p>{label}</p><small>{detail}</small></div></div>; }
function pricePreview(value: number) { return Number.isFinite(value) && value > 0 ? value.toExponential(3).replace("e+", "e") : "—"; }
