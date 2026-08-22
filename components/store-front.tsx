"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Crown, Gem, Gift, PackageOpen, Rocket, Sparkles, Star, UserRound, Zap } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { StoreCategory, StoreProduct } from "@/lib/store";
import { useTelegramProfile } from "@/components/telegram-provider";

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
  currency: { title: "MXM Coins", note: "Внутренняя валюта для игровых предметов и возможностей" },
  membership: { title: "Premium", note: "Ежедневные бонусы и расширенные лимиты" },
  season: { title: "Battle Pass", note: "Премиальная дорожка текущего 30-дневного сезона" },
  cases: { title: "Cases", note: "Вероятности наград открыты до покупки" },
  energy: { title: "Energy", note: "Восстановление ресурса для запусков и событий" },
  creator: { title: "Creator Tools", note: "Продвижение, верификация и расширенная аналитика" },
  profile: { title: "Profile", note: "Постоянные косметические предметы без влияния на рынок" },
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

function categoryDetails(category: StoreCategory) {
  return categoryCopy[category];
}

function categoryGlyph(category: StoreCategory) {
  return categoryIcon[category];
}

export function StoreFront({ initialCategory = "currency" }: { initialCategory?: StoreCategory }) {
  const { refreshProfile, haptic } = useTelegramProfile();
  const [data, setData] = useState<StorePayload | null>(null);
  const [category, setCategory] = useState<StoreCategory>(initialCategory);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creatorCoinId, setCreatorCoinId] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const mxmRequestIdsRef = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    const payload = await apiFetch<StorePayload>("/api/store", { cacheMs: 0 });
    setData(payload);
    setCreatorCoinId((current) => current || payload.creatorCoins[0]?.id || "");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error) => setNotice(error instanceof Error ? error.message : "Не удалось загрузить магазин"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const products = useMemo(() => (data?.products || []).filter((product) => product.category === category), [data?.products, category]);
  const inventory = useMemo(() => new Map((data?.inventory || []).map((item) => [item.sku, Number(item.quantity)])), [data?.inventory]);
  const mxmShop = useMemo(() => new Map((data?.mxmShop || []).map((item) => [item.sku, item])), [data?.mxmShop]);

  function unavailableReason(product: StoreProduct) {
    if (!data) return null;
    if (product.metadata.entitlement === "season_pass" && data.entitlements.some((item) => item.key === "season_pass")) return "Уже открыт";
    if (typeof product.metadata.profileItem === "string" && data.profileItems.some((item) => item.key === product.metadata.profileItem)) return "Уже получено";
    if (product.metadata.energyRefill === true && data.wallet.energy >= data.wallet.maxEnergy) return "Energy полна";
    if (product.category === "cases" && data.caseAvailability[product.sku] === 0) return "Распродано";
    return null;
  }

  async function buy(product: StoreProduct) {
    if (busy || !data?.migrationReady) return;
    if (!termsAccepted) {
      setNotice("Подтверди условия цифровой покупки перед оплатой");
      return;
    }
    const requiresCoin = product.metadata.requiresCoin === true;
    if (requiresCoin && !creatorCoinId) {
      setNotice("Сначала создай мемкоин или выбери существующий");
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
      if (!webApp?.openInvoice) throw new Error("Открой MXM внутри актуального Telegram");
      webApp.openInvoice(invoice.invoiceUrl, (status) => {
        if (status !== "paid" && status !== "pending") {
          setBusy(null);
          setNotice(status === "cancelled" ? "Оплата отменена" : "Платёж не завершён");
          return;
        }
        setNotice(status === "paid" ? "Telegram подтвердил оплату. Выдаём покупку…" : "Платёж обрабатывается Telegram…");
        let tries = 0;
        const poll = async () => {
          tries += 1;
          try {
            const result = await apiFetch<{ purchase: { status: string; productSku?: string | null } }>(`/api/stars/status/${invoice.purchaseId}`, { cacheMs: 0 });
            if (result.purchase.status === "paid") {
              await Promise.all([load(), refreshProfile()]);
              setNotice("Покупка зачислена в аккаунт");
              setBusy(null);
              haptic("heavy");
              return;
            }
          } catch { /* Telegram webhook can arrive slightly later. */ }
          if (tries < 16) window.setTimeout(poll, 800);
          else {
            setNotice("Платёж принят. Покупка появится после webhook-подтверждения.");
            setBusy(null);
          }
        };
        void poll();
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось открыть оплату Stars");
      setBusy(null);
    }
  }

  async function claimDaily() {
    if (busy || !data?.wallet.dailyBonusAvailable) return;
    setBusy("daily");
    setNotice(null);
    try {
      const result = await apiFetch<{ reward: { mxmCoins: number; energy: number } }>("/api/store/daily", { method: "POST", body: "{}" });
      await load();
      setNotice(`Ежедневный Premium-бонус: +${result.reward.mxmCoins.toLocaleString("ru-RU")} MXM Coins · +${result.reward.energy} Energy`);
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
      setNotice(`${result.reward?.label || product.rewardLabel} получено за ${Number(result.price).toLocaleString("ru-RU")} MXM Coins`);
      haptic("heavy");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Покупка за MXM Coins не выполнена");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-4 border-b border-[var(--border-soft)] pb-4">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] uppercase tracking-[.14em] text-[var(--muted-2)]">Telegram Stars</p><h1 className="mt-1 text-[20px] font-semibold tracking-[-.035em]">MXM Store</h1><p className="mt-1.5 max-w-2xl text-[11px] leading-5 text-[var(--muted)]">Игровая валюта, пропуски и косметика внутри виртуальной экономики MXM. Ничего из магазина нельзя вывести, обменять на деньги или Toncoin.</p></div>
          <div className="shrink-0 text-right"><p className="text-[9px] text-[var(--muted)]">Баланс</p><p className="mt-1 flex items-center justify-end gap-1 text-sm font-semibold"><Gem size={13} className="text-[var(--accent)]" />{Number(data?.wallet.mxmCoins || 0).toLocaleString("ru-RU")} MXM</p><p className="mt-1 flex items-center justify-end gap-1 text-[9px] text-[var(--muted)]"><Zap size={10} />{data?.wallet.energy ?? 100}/{data?.wallet.maxEnergy ?? 100} Energy</p></div>
        </div>
        {data?.wallet.premiumActive ? <div className="mt-3 flex items-center gap-2 border-l-2 border-[#f5c451] px-2 text-[10px] text-[#f3d789]"><Crown size={12} />MXM Premium до {new Date(data.wallet.premiumUntil!).toLocaleDateString("ru-RU")}{data.wallet.dailyBonusAvailable ? <button type="button" disabled={Boolean(busy)} onClick={() => void claimDaily()} className="ml-auto text-white underline decoration-white/30 underline-offset-4">Получить daily bonus</button> : <span className="ml-auto text-[var(--muted)]">Бонус сегодня получен</span>}</div> : null}
      </header>

      <nav className="mxm-hscroll mb-4 gap-2 pb-1">
        <Link href="/season" className="mxm-quick-link"><Sparkles size={14} />Сезон</Link>
        <Link href="/cases" className="mxm-quick-link"><PackageOpen size={14} />Кейсы</Link>
        <Link href="/collections" className="mxm-quick-link"><Gift size={14} />Коллекции</Link>
        <Link href="/creator" className="mxm-quick-link"><Rocket size={14} />Creator</Link>
      </nav>

      {!data?.migrationReady && data ? <div className="mxm-alert mxm-alert-error mb-4">Каталог работает в режиме предпросмотра. Для покупок примените миграцию <code>{data.migration}</code>.</div> : null}
      {notice ? <div className="mxm-alert mb-4">{notice}</div> : null}
      {data && !data.starsEnabled ? <div className="mxm-alert mb-4">Покупки за Telegram Stars временно отключены. Доступные товары всё ещё можно получать за MXM Coins.</div> : null}

      <label className="mb-4 flex cursor-pointer items-start gap-2 text-[9px] leading-4 text-[var(--muted)]"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} className="mt-0.5 accent-white" /><span>Я понимаю, что покупаю только цифровые предметы внутри MXM, и принимаю <Link href="/terms" className="text-white underline decoration-white/30 underline-offset-2">условия покупок</Link>. Для вопросов доступна <Link href="/paysupport" className="text-white underline decoration-white/30 underline-offset-2">платёжная поддержка</Link>.</span></label>

      <div className="mxm-hscroll mb-4 gap-1.5 pb-1">
        {categoryOrder.map((value) => <button key={value} type="button" onClick={() => setCategory(value)} className={`mxm-filter-chip ${category === value ? "is-active" : ""}`}>{categoryGlyph(value)}{categoryDetails(value).title}</button>)}
      </div>

      <section>
        <div className="mb-3"><h2 className="text-[13px] font-semibold">{categoryDetails(category).title}</h2><p className="mt-1 text-[9px] text-[var(--muted)]">{categoryDetails(category).note}</p></div>
        {category === "creator" && data?.creatorCoins.length ? <label className="mb-3 block max-w-sm text-[10px] text-[var(--muted)]">Коин для продвижения<select value={creatorCoinId} onChange={(event) => setCreatorCoinId(event.target.value)} className="mxm-input mt-1.5 w-full text-white">{data.creatorCoins.map((coin) => <option key={coin.id} value={coin.id}>{coin.name} · ${coin.symbol}</option>)}</select></label> : null}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => {
            const owned = inventory.get(product.sku) || 0;
            const sink = mxmShop.get(product.sku);
            const unavailable = unavailableReason(product);
            return <article key={product.sku} className="mxm-card flex min-h-[164px] flex-col p-3.5">
              <div className="flex items-start gap-2"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-[11px] bg-white/[.045] text-[var(--accent)]">{categoryGlyph(product.category)}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-[12px] font-semibold">{product.title}</h3>{product.badge ? <span className="rounded-md bg-white/[.06] px-1.5 py-0.5 text-[8px] text-[var(--muted)]">{product.badge}</span> : null}</div><p className="mt-1 text-[10px] font-medium text-[var(--accent)]">{product.rewardLabel}</p></div></div>
              <p className="mt-3 flex-1 text-[9px] leading-4 text-[var(--muted)]">{product.description}</p>
              {product.metadata.entitlement === "season_pass" && data?.currentSeason ? <p className="mt-2 text-[9px] text-[#f3d789]">Действует до {new Date(data.currentSeason.endsAt).toLocaleString("ru-RU")} · осталось {data.currentSeason.daysLeft} дн.</p> : null}
              {product.category === "cases" ? <details className="mt-2 border-t border-[var(--border-soft)] pt-2 text-[9px] text-[var(--muted)]"><summary className="cursor-pointer text-white">Вероятности наград до покупки</summary><div className="mt-2 grid gap-1">{(data?.caseOdds[product.sku] || []).map((odd) => <div key={`${product.sku}:${odd.label}`} className="flex justify-between gap-3"><span>{odd.label} · {odd.rarity}</span><span className="shrink-0 text-white">{odd.percent.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%</span></div>)}</div><Link href="/cases" className="mt-2 inline-block text-[var(--accent)] underline decoration-current/30 underline-offset-2">Все правила и история открытий</Link></details> : null}
              <div className="mt-3 flex items-center justify-between gap-3">{unavailable ? <span className="inline-flex items-center gap-1 text-[9px] text-[var(--muted)]"><CheckCircle2 size={11} />{unavailable}</span> : owned > 0 ? <span className="inline-flex items-center gap-1 text-[9px] text-[var(--positive)]"><CheckCircle2 size={11} />В инвентаре: {owned}</span> : <span className="text-[8px] text-[var(--muted-2)]">Без реальной стоимости</span>}<div className="flex gap-1.5">{sink ? <button type="button" disabled={Boolean(busy) || !data?.migrationReady || Boolean(unavailable) || data.wallet.mxmCoins < sink.mxmPrice} onClick={() => void buyWithMxm(product)} className="inline-flex min-w-[76px] items-center justify-center gap-1 rounded-[12px] border border-white/10 px-2.5 py-2 text-[10px] font-semibold text-white disabled:opacity-40"><Gem size={11} />{busy === `mxm:${product.sku}` ? "…" : sink.mxmPrice.toLocaleString("ru-RU")}</button> : null}<button type="button" disabled={Boolean(busy) || !data?.migrationReady || !data?.starsEnabled || !termsAccepted || Boolean(unavailable)} onClick={() => void buy(product)} className="inline-flex min-w-[76px] items-center justify-center gap-1 rounded-[12px] bg-white px-3 py-2 text-[10px] font-semibold text-black disabled:opacity-40"><Star size={11} fill="currentColor" />{busy === product.sku ? "…" : product.stars}</button></div></div>
            </article>;
          })}
        </div>
      </section>
    </div>
  );
}
