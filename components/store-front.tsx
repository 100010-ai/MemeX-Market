"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  Crown,
  Gem,
  Gift,
  Info,
  PackageOpen,
  Rocket,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
  Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { StoreCategory, StoreProduct } from "@/lib/store";
import { useTelegramProfile } from "@/components/telegram-provider";
import { ProfileAvatar } from "@/components/profile-avatar";
import { getProfileFrameDefinition } from "@/lib/profile-frames";
import { rarityLabel } from "@/lib/ui-copy";
import { telegramVersionAtLeast } from "@/lib/telegram-webapp";

type Wallet = {
  mxmCoins: number;
  energy: number;
  maxEnergy: number;
  premiumUntil: string | null;
  premiumActive: boolean;
  dailyBonusAvailable: boolean;
  vipTier: string;
  vipProgress: number;
};

type StorePayload = {
  products: StoreProduct[];
  wallet: Wallet;
  inventory: Array<{ sku: string; quantity: number }>;
  entitlements: Array<{ key: string; expiresAt: string | null }>;
  profileItems: Array<{ key: string; type: string; title: string; equipped: boolean }>;
  mxmShop: Array<{ sku: string; mxmPrice: number; title: string; rewardLabel: string; metadata: Record<string, unknown> }>;
  creatorCoins: Array<{ id: string; name: string; symbol: string }>;
  caseOdds: Record<string, Array<{ label: string; percent: number; rarity: string }>>;
  caseAvailability: Record<string, number | null>;
  currentSeason: { id: string; title: string; startsAt: string; endsAt: string; daysLeft: number } | null;
  starsEnabled: boolean;
  migrationReady: boolean;
  migration?: string;
};

const categoryOrder: StoreCategory[] = ["currency", "membership", "season", "cases", "energy", "creator", "profile"];
const categoryCopy: Record<StoreCategory, { title: string; note: string }> = {
  currency: { title: "Монеты MXM", note: "Для магазина и прогрессии" },
  membership: { title: "Премиум", note: "Энергия и ежедневные бонусы" },
  season: { title: "Боевой пропуск", note: "Премиальная дорожка сезона" },
  cases: { title: "Кейсы", note: "Шансы и лимиты открыты" },
  energy: { title: "Энергия", note: "Запас для активностей" },
  creator: { title: "Инструменты автора", note: "Продвижение и аналитика" },
  profile: { title: "Рамки профиля", note: "Коллекционное оформление" },
};

const categoryIcon: Record<StoreCategory, React.ReactNode> = {
  currency: <Gem size={14} />,
  membership: <Crown size={14} />,
  season: <Sparkles size={14} />,
  cases: <PackageOpen size={14} />,
  energy: <Zap size={14} />,
  creator: <Rocket size={14} />,
  profile: <UserRound size={14} />,
};

const rarityRank: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

function categoryDetails(category: StoreCategory) {
  return categoryCopy[category];
}

function categoryGlyph(category: StoreCategory) {
  return categoryIcon[category];
}

function metadataTextList(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 80)] : []).slice(0, 2);
}

function profileItemKey(product: StoreProduct) {
  return typeof product.metadata.profileItem === "string" ? product.metadata.profileItem : null;
}

function CaseOddsSummary({ odds }: { odds: Array<{ label: string; percent: number; rarity: string }> }) {
  if (!odds.length) return null;
  const rarePlus = odds.reduce((sum, odd) => sum + (rarityRank[odd.rarity] >= rarityRank.rare ? odd.percent : 0), 0);
  const epicPlus = odds.reduce((sum, odd) => sum + (rarityRank[odd.rarity] >= rarityRank.epic ? odd.percent : 0), 0);
  return <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-[var(--muted)]">
    <span>Редкое+ <b className="font-medium text-white">{rarePlus.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%</b></span>
    <span>Эпическое+ <b className="font-medium text-white">{epicPlus.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%</b></span>
  </div>;
}

export function StoreFront({ initialCategory = "currency" }: { initialCategory?: StoreCategory }) {
  const { profile, refreshProfile, haptic } = useTelegramProfile();
  const [data, setData] = useState<StorePayload | null>(null);
  const [category, setCategory] = useState<StoreCategory>(initialCategory);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creatorCoinId, setCreatorCoinId] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [pendingStarsProduct, setPendingStarsProduct] = useState<StoreProduct | null>(null);
  const [termsDraftAccepted, setTermsDraftAccepted] = useState(false);
  const mxmRequestIdsRef = useRef(new Map<string, string>());
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    const payload = await apiFetch<StorePayload>("/api/store", { cacheMs: 20_000 });
    if (!mountedRef.current) return;
    setData(payload);
    setCreatorCoinId((current) => current || payload.creatorCoins[0]?.id || "");
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const timer = window.setTimeout(() => {
      void load().catch((error) => {
        if (mountedRef.current) setNotice(error instanceof Error ? error.message : "Не удалось загрузить магазин");
      });
    }, 0);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(timer);
    };
  }, [load]);

  const products = useMemo(() => (data?.products || []).filter((product) => product.category === category), [data?.products, category]);
  const inventory = useMemo(() => new Map((data?.inventory || []).map((item) => [item.sku, Number(item.quantity)])), [data?.inventory]);
  const mxmShop = useMemo(() => new Map((data?.mxmShop || []).map((item) => [item.sku, item])), [data?.mxmShop]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<StoreCategory, number>();
    for (const product of data?.products || []) counts.set(product.category, (counts.get(product.category) || 0) + 1);
    return counts;
  }, [data?.products]);

  function unavailableReason(product: StoreProduct) {
    if (!data) return null;
    if (product.metadata.entitlement === "season_pass" && data.entitlements.some((item) => item.key === "season_pass")) return "Уже открыт";
    if (typeof product.metadata.profileItem === "string" && data.profileItems.some((item) => item.key === product.metadata.profileItem)) return "Уже получено";
    if (product.metadata.energyRefill === true && data.wallet.energy >= data.wallet.maxEnergy) return "Энергия заполнена";
    if (product.category === "cases" && data.caseAvailability[product.sku] === 0) return "Распродано";
    return null;
  }

  function startStarsPurchase(product: StoreProduct) {
    if (busy || !data?.migrationReady || !data.starsEnabled || unavailableReason(product)) return;
    if (!termsAccepted) {
      setTermsDraftAccepted(false);
      setPendingStarsProduct(product);
      setNotice(null);
      haptic("light");
      return;
    }
    void buy(product);
  }

  function closePurchaseConsent() {
    if (busy) return;
    setPendingStarsProduct(null);
    setTermsDraftAccepted(false);
  }

  function confirmPurchaseConsent() {
    const product = pendingStarsProduct;
    if (!product || !termsDraftAccepted || busy) return;
    setTermsAccepted(true);
    setPendingStarsProduct(null);
    setTermsDraftAccepted(false);
    void buy(product);
  }

  async function buy(product: StoreProduct) {
    if (busy || !data?.migrationReady || !data.starsEnabled || unavailableReason(product)) return;
    const requiresCoin = product.metadata.requiresCoin === true;
    if (requiresCoin && !creatorCoinId) {
      setNotice("Для этого инструмента сначала нужен свой активный мемкоин. Создай его или выбери существующий.");
      return;
    }
    setBusy(product.sku);
    setNotice(null);
    haptic("medium");
    try {
      const invoice = await apiFetch<{ purchaseId: string; invoiceUrl: string }>("/api/stars/invoice", {
        method: "POST",
        body: JSON.stringify({ sku: product.sku, termsAccepted: true, context: requiresCoin ? { coinId: creatorCoinId } : {} }),
      });
      const webApp = window.Telegram?.WebApp;
      if (!telegramVersionAtLeast(webApp, "6.1") || !webApp?.openInvoice) {
        throw new Error("Обнови Telegram, чтобы оплачивать покупки Stars внутри приложения");
      }
      webApp.openInvoice(invoice.invoiceUrl, (status) => {
        if (!mountedRef.current) return;
        if (status !== "paid" && status !== "pending") {
          setBusy(null);
          setNotice(status === "cancelled" ? "Оплата отменена" : "Платёж не завершён");
          return;
        }
        setNotice(status === "paid" ? "Telegram подтвердил оплату. Зачисляем покупку…" : "Платёж обрабатывается Telegram…");
        let tries = 0;
        const poll = async () => {
          if (!mountedRef.current) return;
          tries += 1;
          try {
            const result = await apiFetch<{ purchase: { status: string; productSku?: string | null } }>(`/api/stars/status/${invoice.purchaseId}`, { cacheMs: 0 });
            if (result.purchase.status === "paid") {
              await Promise.all([load(), refreshProfile()]);
              if (!mountedRef.current) return;
              setNotice("Покупка зачислена в аккаунт");
              setBusy(null);
              haptic("heavy");
              return;
            }
            if (["cancelled", "expired", "refunded"].includes(result.purchase.status)) {
              setNotice("Платёж не был зачислен. Обнови магазин и повтори попытку.");
              setBusy(null);
              return;
            }
          } catch { /* Telegram webhook can arrive slightly later. */ }
          if (tries < 18) window.setTimeout(poll, 850);
          else {
            setNotice("Telegram принял платёж. Покупка появится после webhook-подтверждения.");
            setBusy(null);
          }
        };
        void poll();
      });
    } catch (error) {
      if (mountedRef.current) {
        setNotice(error instanceof Error ? error.message : "Не удалось открыть оплату Stars");
        setBusy(null);
      }
    }
  }

  async function claimDaily() {
    if (busy || !data?.wallet.dailyBonusAvailable) return;
    setBusy("daily");
    setNotice(null);
    try {
      const result = await apiFetch<{ reward: { mxmCoins: number; energy: number } }>("/api/store/daily", { method: "POST", body: "{}" });
      await load();
      setNotice(`Ежедневный премиум-бонус: +${result.reward.mxmCoins.toLocaleString("ru-RU")} MXM · +${result.reward.energy} энергии`);
      haptic("heavy");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось получить бонус");
    } finally {
      setBusy(null);
    }
  }

  async function buyWithMxm(product: StoreProduct) {
    if (busy || !data?.migrationReady) return;
    setBusy(`mxm:${product.sku}`);
    setNotice(null);
    try {
      const requestId = mxmRequestIdsRef.current.get(product.sku) || crypto.randomUUID();
      mxmRequestIdsRef.current.set(product.sku, requestId);
      const result = await apiFetch<{ status: string; price: number; reward: { label?: string }; mxmCoins: number }>("/api/store/mxm", {
        method: "POST",
        body: JSON.stringify({ sku: product.sku, requestId }),
      });
      mxmRequestIdsRef.current.delete(product.sku);
      await Promise.all([load(), refreshProfile()]);
      setNotice(`${result.reward?.label || product.rewardLabel} получено за ${Number(result.price).toLocaleString("ru-RU")} MXM`);
      haptic("heavy");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Покупка за MXM не выполнена");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-3 border-b border-[var(--border-soft)] pb-3">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] uppercase tracking-[.14em] text-[var(--muted-2)]">Telegram Stars · MXM</p><h1 className="mt-1 text-[18px] font-semibold tracking-[-.035em]">Магазин MXM</h1><p className="mt-1 max-w-2xl text-[9px] leading-4 text-[var(--muted)]">Кейсы, пропуск, косметика и инструменты для виртуальной экономики MXM.</p></div>
          <div className="shrink-0 text-right"><p className="text-[9px] text-[var(--muted)]">Баланс</p><p className="mt-1 flex items-center justify-end gap-1 text-sm font-semibold"><Gem size={13} className="text-[var(--accent)]" />{Number(data?.wallet.mxmCoins || 0).toLocaleString("ru-RU")} MXM</p><p className="mt-1 flex items-center justify-end gap-1 text-[9px] text-[var(--muted)]"><Zap size={10} />{data?.wallet.energy ?? 100}/{data?.wallet.maxEnergy ?? 100} энергии</p></div>
        </div>
        {data?.wallet.premiumActive ? <div className="mt-3 flex items-center gap-2 border-l-2 border-[#f5c451] px-2 text-[10px] text-[#f3d789]"><Crown size={12} />Премиум MXM до {new Date(data.wallet.premiumUntil!).toLocaleDateString("ru-RU")}{data.wallet.dailyBonusAvailable ? <button type="button" disabled={Boolean(busy)} onClick={() => void claimDaily()} className="ml-auto text-white underline decoration-white/30 underline-offset-4">Получить ежедневный бонус</button> : <span className="ml-auto text-[var(--muted)]">Бонус сегодня получен</span>}</div> : null}
      </header>

      <nav className="mxm-hscroll mb-3 gap-2 pb-1">
        <Link href="/season" className="mxm-quick-link"><Sparkles size={14} />Боевой пропуск</Link>
        <Link href="/cases" className="mxm-quick-link"><PackageOpen size={14} />Кейсы</Link>
        <Link href="/collections" className="mxm-quick-link"><Gift size={14} />Коллекции</Link>
        <Link href="/creator" className="mxm-quick-link"><Rocket size={14} />Авторам</Link>
      </nav>

      {!data?.migrationReady && data ? <div className="mxm-alert mxm-alert-error mb-3">Каталог работает в режиме предпросмотра. Для покупок примените миграцию <code>{data.migration}</code>.</div> : null}
      {notice ? <div aria-live="polite" className="mxm-alert mb-3">{notice}</div> : null}
      {data && !data.starsEnabled ? <div className="mxm-alert mb-3">Покупки за Telegram Stars временно отключены в Runtime Config. Товары с ценой в MXM остаются доступны.</div> : null}

      <div className="mb-3 flex items-start gap-2 border-y border-[var(--border-soft)] py-2.5 text-[8px] leading-4 text-[var(--muted)]">
        <ShieldCheck size={12} className="mt-0.5 shrink-0 text-[var(--accent)]" />
        <span>Stars-покупки проходят через официальный Telegram Invoice. <Link href="/terms" className="text-white underline decoration-white/30 underline-offset-2">Условия</Link> · <Link href="/paysupport" className="text-white underline decoration-white/30 underline-offset-2">поддержка</Link>.</span>
      </div>

      <div className="mxm-hscroll mb-3 gap-1.5 pb-1">
        {categoryOrder.map((value) => <button key={value} type="button" onClick={() => setCategory(value)} className={`mxm-filter-chip ${category === value ? "is-active" : ""}`}>{categoryGlyph(value)}{categoryDetails(value).title}<span className="text-[8px] text-[var(--muted-2)]">{categoryCounts.get(value) || 0}</span></button>)}
      </div>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-[13px] font-semibold">{categoryDetails(category).title}</h2><p className="mt-1 text-[9px] text-[var(--muted)]">{categoryDetails(category).note}</p></div>{category === "season" ? <Link href="/season" className="inline-flex items-center gap-1 text-[9px] text-[var(--accent)]">Открыть сезон <ChevronRight size={11} /></Link> : category === "cases" ? <Link href="/cases" className="inline-flex items-center gap-1 text-[9px] text-[var(--accent)]">Мои кейсы <ChevronRight size={11} /></Link> : null}</div>
        {category === "creator" && data?.creatorCoins.length ? <label className="mb-3 block max-w-sm text-[10px] text-[var(--muted)]">Мемкоин для продвижения<select value={creatorCoinId} onChange={(event) => setCreatorCoinId(event.target.value)} className="mxm-input mt-1.5 w-full text-white">{data.creatorCoins.map((coin) => <option key={coin.id} value={coin.id}>{coin.name} · ${coin.symbol}</option>)}</select></label> : null}
        {category === "creator" && data && !data.creatorCoins.length ? <div className="mb-3 flex items-center justify-between gap-3 border-y border-[var(--border-soft)] py-3 text-[9px] text-[var(--muted)]"><span>Продвижение требует собственного активного мемкоина.</span><Link href="/create" className="text-[var(--accent)]">Создать</Link></div> : null}

        {!data ? <div className="grid gap-3 md:grid-cols-2"><div className="mxm-skeleton h-44" /><div className="mxm-skeleton h-44" /></div> : products.length ? <div className="grid gap-x-5 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => {
            const owned = inventory.get(product.sku) || 0;
            const sink = mxmShop.get(product.sku);
            const unavailable = unavailableReason(product);
            const highlights = metadataTextList(product.metadata, "highlights");
            const itemKey = profileItemKey(product);
            const frame = itemKey ? getProfileFrameDefinition(itemKey) : null;
            const odds = data.caseOdds[product.sku] || [];
            const insufficientMxm = Boolean(sink && data.wallet.mxmCoins < sink.mxmPrice);
            const actionReason = unavailable
              || (!data.migrationReady ? "Магазин обновляется — покупки временно недоступны" : null)
              || (!data.starsEnabled && !sink ? "Покупки Stars временно отключены" : null)
              || (insufficientMxm && sink ? `Не хватает ${(sink.mxmPrice - data.wallet.mxmCoins).toLocaleString("ru-RU")} MXM` : null);
            return <article key={product.sku} className="mxm-card mxm-store-product flex min-h-[164px] flex-col py-3">
              <div className="flex items-start gap-3">
                {frame ? <ProfileAvatar photoUrl={profile?.photoUrl || null} name={profile?.firstName || "MXM"} equippedFrame={frame.key} /> : <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-white/[.045] text-[var(--accent)]">{categoryGlyph(product.category)}</div>}
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-[12px] font-semibold">{product.title}</h3>{product.badge ? <span className="rounded-md bg-white/[.06] px-1.5 py-0.5 text-[8px] text-[var(--muted)]">{product.badge}</span> : null}{frame ? <span className="inline-flex items-center gap-1 text-[8px] text-[var(--muted)]"><BadgeCheck size={9} />{rarityLabel(frame.rarity)}</span> : null}</div><p className="mt-1 text-[10px] font-medium text-[var(--accent)]">{product.rewardLabel}</p></div>
              </div>
              <p className="mt-2 line-clamp-2 text-[9px] leading-4 text-[var(--muted)]">{product.description}</p>
              {highlights.length ? <div className="mt-2 grid gap-1">{highlights.slice(0, 2).map((item) => <span key={item} className="flex items-center gap-1.5 text-[8px] text-[var(--muted)]"><CheckCircle2 size={9} className="text-[var(--positive)]" />{item}</span>)}</div> : null}
              {product.metadata.entitlement === "season_pass" && data.currentSeason ? <p className="mt-2 text-[9px] text-[#f3d789]">Действует до конца текущего сезона · осталось {data.currentSeason.daysLeft} дн.</p> : null}
              {product.category === "cases" ? <><CaseOddsSummary odds={odds} /><details className="mt-2 border-t border-[var(--border-soft)] pt-2 text-[9px] text-[var(--muted)]"><summary className="cursor-pointer text-white">Все вероятности наград</summary><div className="mt-2 grid gap-1">{odds.map((odd) => <div key={`${product.sku}:${odd.label}`} className="flex justify-between gap-3"><span>{odd.label} · {rarityLabel(odd.rarity)}</span><span className="shrink-0 text-white">{odd.percent.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%</span></div>)}</div></details></> : null}
              <div className="mt-auto pt-3">
                <div className="mb-2 min-h-4">{unavailable ? <span className="inline-flex items-center gap-1 text-[9px] text-[var(--muted)]"><CheckCircle2 size={11} />{unavailable}</span> : owned > 0 ? <span className="inline-flex items-center gap-1 text-[9px] text-[var(--positive)]"><CheckCircle2 size={11} />В инвентаре: {owned}</span> : product.category === "cases" && data.caseAvailability[product.sku] != null ? <span className="text-[8px] text-[var(--muted-2)]">Осталось в серии: {Number(data.caseAvailability[product.sku]).toLocaleString("ru-RU")}</span> : <span className="inline-flex items-center gap-1 text-[8px] text-[var(--muted-2)]"><ShieldCheck size={9} />Без реальной стоимости</span>}</div>
                <div className="flex flex-wrap items-stretch gap-1.5">
                  {sink ? <button type="button" title={insufficientMxm ? `Нужно ${sink.mxmPrice.toLocaleString("ru-RU")} MXM` : "Купить за MXM"} disabled={Boolean(busy) || !data.migrationReady || Boolean(unavailable) || insufficientMxm} onClick={() => void buyWithMxm(product)} className="mxm-secondary-action min-w-[92px] flex-1 !text-[10px]"><Gem size={11} />{busy === `mxm:${product.sku}` ? "Покупка…" : sink.mxmPrice.toLocaleString("ru-RU")}</button> : null}
                  <button type="button" title={!data.starsEnabled ? "Покупки Stars отключены в Runtime Config" : unavailable || "Купить за Telegram Stars"} disabled={Boolean(busy) || !data.migrationReady || !data.starsEnabled || Boolean(unavailable)} onClick={() => startStarsPurchase(product)} className="mxm-primary-action min-w-[104px] flex-1"><Star size={11} fill="currentColor" />{busy === product.sku ? "Открываем…" : unavailable ? unavailable : `${product.stars} · Купить`}</button>
                </div>
                {actionReason ? <span className="mt-1.5 inline-flex items-center gap-1 text-[8px] text-[var(--muted)]"><Info size={9} />{actionReason}</span> : null}
              </div>
            </article>;
          })}
        </div> : <div className="border-y border-[var(--border-soft)] py-10 text-center"><p className="text-[11px] text-[var(--muted)]">В этой категории пока нет активных товаров.</p></div>}
      </section>

      {pendingStarsProduct ? <div className="fixed inset-0 z-[120] flex items-end justify-center p-0 md:items-center md:p-5">
        <button type="button" aria-label="Закрыть подтверждение покупки" className="mxm-sheet-backdrop absolute inset-0 bg-black/75" onClick={closePurchaseConsent} />
        <section role="dialog" aria-modal="true" aria-labelledby="mxm-store-consent-title" className="mxm-sheet-panel relative z-[1] w-full max-w-md rounded-t-[24px] border border-[var(--border)] bg-[var(--bg)] p-4 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-[0_-18px_56px_rgba(0,0,0,.55)] md:rounded-[24px] md:pb-4">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-[8px] uppercase tracking-[.14em] text-[var(--muted-2)]">Подтверждение Stars</p><h3 id="mxm-store-consent-title" className="mt-1 text-[15px] font-semibold">{pendingStarsProduct.title}</h3><p className="mt-1 text-[10px] text-[var(--accent)]">{pendingStarsProduct.rewardLabel}</p></div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-[10px] bg-[var(--accent)] px-2.5 py-1.5 text-[10px] font-semibold text-[#0b0f15]"><Star size={11} fill="currentColor" />{pendingStarsProduct.stars}</span>
          </div>
          <div className="mt-4 rounded-[14px] border border-white/[.08] bg-white/[.025] p-3 text-[9px] leading-4 text-[var(--muted)]">
            Это виртуальный цифровой товар внутри MXM. Он не является TON, криптовалютой или денежным активом, не имеет гарантированной реальной стоимости и не выводится в деньги.
          </div>
          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-[14px] border border-[var(--border-soft)] p-3 text-[9px] leading-4 text-[var(--muted)]">
            <input autoFocus type="checkbox" checked={termsDraftAccepted} onChange={(event) => setTermsDraftAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Я понимаю характер цифровой покупки и принимаю <Link href="/terms" className="text-white underline decoration-white/30 underline-offset-2">условия покупок MXM</Link>.</span>
          </label>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" disabled={Boolean(busy)} onClick={closePurchaseConsent} className="min-h-10 rounded-[13px] border border-white/10 px-3 text-[10px] font-semibold text-white disabled:opacity-40">Отмена</button>
            <button type="button" disabled={!termsDraftAccepted || Boolean(busy)} onClick={confirmPurchaseConsent} className="mxm-primary-action min-h-10"><Star size={11} fill="currentColor" />Подтвердить</button>
          </div>
          
        </section>
      </div> : null}
    </div>
  );
}
