"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, Bell, Bot, Box, Boxes, CircleDollarSign, Coins, Copy, ExternalLink, Gift,
  Gauge, Hash, Megaphone, Package, RefreshCw, Search, Settings2, Shield, ShieldAlert, SlidersHorizontal,
  Sparkles, Star, Store, TerminalSquare, UserRound, Users, Wrench, X, Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import styles from "./ops.module.css";

type Runtime = {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  featureFlags: { gifts: boolean; memecoins: boolean; referrals: boolean; stars: boolean };
  remoteConfig: Record<string, number>;
  updatedAt: string;
};

type OpsSnapshot = {
  operator: { id: string; telegramId: number; username: string | null; firstName: string };
  release: { environment: string; commit: string | null; url: string | null; region: string | null };
  runtime: Runtime;
  metrics: {
    users: number; newUsers24h: number; bannedUsers: number; activeCoins: number; hiddenCoins: number; listedGifts: number;
    activeMissions: number; openConditionalOrders: number; stars24h: number; refundedStars24h: number; netStars24h: number;
    activeProducts: number; activeCases: number; reversalQueue: number; recentErrorGroups: number;
  };
  alerts: Array<{ id: string; level: "info" | "warn" | "critical"; title: string; detail: string; href?: string }>;
  products: Array<{ sku: string; title: string; category: string; stars_price: number; active: boolean; badge: string | null; updated_at: string }>;
  cases: Array<{ sku: string; title: string; tier: string; remaining_supply: number | null; active: boolean; rare_pity: number; epic_pity: number; legendary_pity: number }>;
  reversals: Array<{ purchase_id: string; profile_id: string; product_sku: string; status: string; details: unknown; created_at: string; processed_at: string | null }>;
  errors: Array<{ id: string; route: string; error_name: string; message: string; count: number; affected_users: number; last_seen_at: string }>;
  audit: Array<{ id: string; actor: string; action: string; target_type: string | null; target_id: string | null; payload: unknown; created_at: string }>;
  activity: Array<{ id: string; kind: string; importance: number; amount: number | null; metadata: unknown; created_at: string }>;
  latestGiftSync: { status: string; unique_received: number; unique_imported: number; assets_updated: number; virtual_created: number; error_message: string | null; started_at: string; finished_at: string | null } | null;
  leagueSeason: { title: string; season_key: string; starts_at: string; ends_at: string; status: string } | null;
  weeklySeason: { title: string; season_key: string; starts_at: string; ends_at: string; week_number: number } | null;
  economy: unknown;
  catalogHealth: unknown;
  checkedAt: string;
};

type SearchResult = {
  type: "profile" | "coin" | "gift" | "product" | "case";
  id: string;
  title: string;
  subtitle: string;
  status: string;
  href: string;
  meta: Record<string, unknown>;
};

type EconomySettings = {
  coin_launch_fee: number;
  coin_launch_cooldown_hours: number;
  coin_max_active: number;
  gift_fee_bps: number;
  referral_bonus_bps: number;
  coin_total_fee_bps: number;
  creator_lock_bps: number;
  creator_lock_days: number;
  early_buyer_limit: number;
  coin_launch_energy_cost: number;
  updated_at: string;
};

type Tab = "overview" | "players" | "economy" | "content" | "system";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Обзор" },
  { id: "players", label: "Игроки" },
  { id: "economy", label: "Экономика" },
  { id: "content", label: "Контент" },
  { id: "system", label: "Система" },
];

const economyFields: Array<{ key: keyof EconomySettings; label: string; hint: string }> = [
  { key: "coin_launch_fee", label: "Launch fee", hint: "TON за запуск мемкоина" },
  { key: "coin_launch_cooldown_hours", label: "Launch cooldown", hint: "Часов между запусками" },
  { key: "coin_max_active", label: "Max active coins", hint: "Лимит активных монет автора" },
  { key: "coin_total_fee_bps", label: "Coin fee", hint: "Комиссия, bps" },
  { key: "gift_fee_bps", label: "Gift fee", hint: "Комиссия Gifts, bps" },
  { key: "referral_bonus_bps", label: "Referral bonus", hint: "Бонус партнёра, bps" },
  { key: "creator_lock_bps", label: "Creator lock", hint: "Lock доли автора, bps" },
  { key: "creator_lock_days", label: "Creator lock days", hint: "Длительность lock" },
  { key: "early_buyer_limit", label: "OG limit", hint: "Количество ранних покупателей" },
  { key: "coin_launch_energy_cost", label: "Launch energy", hint: "Энергия за запуск" },
];

function n(value: unknown) { const x = Number(value); return Number.isFinite(x) ? x : 0; }
function compact(value: unknown) { return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(n(value)); }
function ago(value: string | null | undefined) {
  if (!value) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}с`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}м`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}ч`;
  return `${Math.floor(seconds / 86400)}д`;
}
function date(value: string | null | undefined) { return value ? new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"; }
function resultIcon(type: SearchResult["type"]) {
  if (type === "profile") return <UserRound size={14} />;
  if (type === "coin") return <Coins size={14} />;
  if (type === "gift") return <Gift size={14} />;
  if (type === "product") return <Store size={14} />;
  return <Box size={14} />;
}

export default function AdminOpsPage() {
  const [data, setData] = useState<OpsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcast, setBroadcast] = useState({ audience: "active7d", title: "", body: "", href: "/hub" });
  const [grant, setGrant] = useState({ balanceDelta: "", mxmDelta: "", energyDelta: "", xpDelta: "", reason: "" });
  const [directNotice, setDirectNotice] = useState({ title: "", body: "", href: "/hub" });
  const [economy, setEconomy] = useState<EconomySettings | null>(null);
  const [economyDraft, setEconomyDraft] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = await apiFetch<OpsSnapshot>("/api/admin/ops", { cacheMs: 0, dedupe: false });
      setData(next);
    } catch (error) {
      notify(error instanceof Error ? error.message : "MemeX Ops не загрузился", true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [notify]);

  const loadEconomy = useCallback(async () => {
    try {
      const payload = await apiFetch<{ economy: EconomySettings }>("/api/admin/ops/economy", { cacheMs: 0, dedupe: false });
      setEconomy(payload.economy);
      setEconomyDraft(Object.fromEntries(economyFields.map(({ key }) => [key, String(payload.economy[key] ?? "")] )));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Настройки экономики не загрузились", true);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === "economy" && !economy) void loadEconomy(); }, [tab, economy, loadEconomy]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (event.key === "Escape") { setSearchOpen(false); if (!broadcastOpen) setSelected(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [broadcastOpen]);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const timer = window.setTimeout(() => {
      void apiFetch<{ results: SearchResult[] }>(`/api/admin/search?q=${encodeURIComponent(query)}`, { cacheMs: 0, dedupe: false })
        .then((payload) => { setResults(payload.results); setSearchOpen(true); })
        .catch(() => setResults([]));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  const action = useCallback(async (name: string, payload: Record<string, unknown> = {}, success = "Готово") => {
    setBusy(name);
    try {
      const result = await apiFetch<Record<string, unknown>>("/api/admin/ops/action", { method: "POST", body: JSON.stringify({ action: name, ...payload }) });
      notify(success);
      await load(true);
      return result;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Операция не выполнена", true);
      throw error;
    } finally {
      setBusy(null);
    }
  }, [load, notify]);

  const metricCards = useMemo(() => data ? [
    { label: "Игроки", value: compact(data.metrics.users), hint: `+${data.metrics.newUsers24h} за 24ч`, icon: <Users size={12} /> },
    { label: "Мемкоины", value: compact(data.metrics.activeCoins), hint: `${data.metrics.hiddenCoins} скрыто`, icon: <Coins size={12} /> },
    { label: "Gifts на рынке", value: compact(data.metrics.listedGifts), hint: data.latestGiftSync ? `sync ${ago(data.latestGiftSync.finished_at || data.latestGiftSync.started_at)}` : "sync —", icon: <Gift size={12} /> },
    { label: "Stars 24ч", value: compact(data.metrics.netStars24h), hint: `${data.metrics.refundedStars24h} refund`, icon: <Star size={12} /> },
    { label: "Открытые ордера", value: compact(data.metrics.openConditionalOrders), hint: "conditional", icon: <Activity size={12} /> },
    { label: "Тревоги", value: compact(data.alerts.length), hint: data.metrics.reversalQueue ? `${data.metrics.reversalQueue} reversal` : "очередь чистая", icon: <ShieldAlert size={12} /> },
  ] : [], [data]);

  function chooseResult(result: SearchResult) {
    setSearchOpen(false);
    setQuery("");
    if (result.type === "profile") { setSelected(result); setTab("players"); }
    else if (result.type === "product" || result.type === "case") setTab("content");
    else window.location.href = result.href;
  }

  async function submitGrant() {
    if (!selected || selected.type !== "profile") return;
    const payload = {
      profileId: selected.id,
      balanceDelta: Number(grant.balanceDelta || 0),
      mxmDelta: Number(grant.mxmDelta || 0),
      energyDelta: Number(grant.energyDelta || 0),
      xpDelta: Number(grant.xpDelta || 0),
      reason: grant.reason,
    };
    try {
      const response = await action("profile.grant", payload, "Ресурсы изменены");
      const result = response.result as { after?: Record<string, unknown> } | undefined;
      if (result?.after) setSelected((current) => current ? { ...current, meta: { ...current.meta, balance: result.after?.balance, mxm_coins: result.after?.mxm, energy: result.after?.energy, xp: result.after?.xp } } : current);
      setGrant({ balanceDelta: "", mxmDelta: "", energyDelta: "", xpDelta: "", reason: "" });
    } catch {}
  }

  async function saveEconomy() {
    const payload: Record<string, unknown> = {};
    for (const { key } of economyFields) {
      const raw = economyDraft[key];
      if (raw !== undefined && raw !== "" && Number(raw) !== Number(economy?.[key])) payload[key] = Number(raw);
    }
    if (!Object.keys(payload).length) { notify("Изменений нет"); return; }
    try { await action("economy.update", payload, "Экономика обновлена"); await loadEconomy(); } catch {}
  }

  async function copyIncident() {
    if (!data) return;
    const bundle = {
      checkedAt: data.checkedAt,
      release: data.release,
      maintenance: data.runtime.maintenanceMode,
      featureFlags: data.runtime.featureFlags,
      metrics: data.metrics,
      alerts: data.alerts,
      latestGiftSync: data.latestGiftSync,
      topErrors: data.errors.slice(0, 5),
    };
    await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
    notify("Incident bundle скопирован");
  }

  if (loading && !data) return <main className={styles.shell}><div className={styles.wrap}><div className={styles.empty}>Загружаю MemeX Ops…</div></div></main>;
  if (!data) return <main className={styles.shell}><div className={styles.wrap}><div className={styles.empty}>Нет доступа к Ops или snapshot недоступен.</div></div></main>;

  const flags = data.runtime.featureFlags;

  return <main className={styles.shell}>
    <div className={styles.wrap}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.logo}><TerminalSquare size={19} /></div>
          <div><h1>MemeX Ops</h1><p>операционный центр · {data.release.environment}</p></div>
        </div>
        <div className={styles.topActions}>
          <span className={styles.chip}>{data.operator.username ? `@${data.operator.username}` : data.operator.firstName}</span>
          <span className={styles.chip}>{data.release.commit ? data.release.commit.slice(0, 7) : "local"}</span>
          <button className={styles.iconButton} title="Обновить" disabled={busy !== null} onClick={() => void load()}><RefreshCw size={14} /></button>
        </div>
      </header>

      <div className={styles.command}>
        <div className={styles.searchBox}>
          <Search size={15} />
          <input ref={searchRef} value={query} onFocus={() => setSearchOpen(true)} onChange={(event) => setQuery(event.target.value)} placeholder="Игрок, @username, Telegram ID, мемкоин, Gift, SKU кейса…" />
          <span className={styles.kbd}>Ctrl K</span>
        </div>
        {searchOpen && query.trim().length >= 2 ? <div className={styles.results}>
          {results.length ? results.map((result) => <button key={`${result.type}:${result.id}`} className={styles.result} onClick={() => chooseResult(result)}>
            <span className={styles.resultIcon}>{resultIcon(result.type)}</span>
            <span><span className={styles.resultTitle}>{result.title}</span><span className={styles.resultSub}>{result.subtitle}</span></span>
            <span className={styles.status}>{result.status}</span>
          </button>) : <div className={styles.empty}>Ничего не найдено</div>}
        </div> : null}
      </div>

      <nav className={styles.tabs}>{tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`${styles.tab} ${tab === item.id ? styles.tabActive : ""}`}>{item.label}</button>)}</nav>

      {data.alerts.length ? <div className={styles.alerts}>{data.alerts.slice(0, 5).map((alert) => <div key={alert.id} className={`${styles.alert} ${alert.level === "warn" ? styles.alertWarn : alert.level === "critical" ? styles.alertCritical : ""}`}>
        <span className={styles.alertDot} /><div><div className={styles.alertTitle}>{alert.title}</div><div className={styles.alertDetail}>{alert.detail}</div></div><AlertTriangle size={13} />
      </div>)}</div> : null}

      <section className={styles.metrics}>{metricCards.map((item) => <div key={item.label} className={styles.metric}>
        <div className={styles.metricTop}><span>{item.label}</span>{item.icon}</div><div className={styles.metricValue}>{item.value}</div><div className={styles.metricHint}>{item.hint}</div>
      </div>)}</section>

      {tab === "overview" ? <div className={styles.grid}>
        <div className={styles.stack}>
          <section className={styles.card}>
            <div className={styles.cardHead}><Zap size={14} /><h2>Быстрые действия</h2><p>без путешествия по 8 вкладкам</p></div>
            <div className={styles.cardBody}><div className={styles.quickGrid}>
              <button className={styles.quick} onClick={() => { setSearchOpen(true); window.setTimeout(() => searchRef.current?.focus(), 0); }}><Search className={styles.quickIcon} size={17} /><b>Найти игрока</b><small>Баланс, бан, MXM, уведомление за несколько кликов</small></button>
              <button className={styles.quick} onClick={() => setBroadcastOpen(true)}><Megaphone className={styles.quickIcon} size={17} /><b>Broadcast</b><small>Все, active 7d, premium или рефереры</small></button>
              <button className={styles.quick} disabled={busy !== null} onClick={() => void action("telegram.test", {}, "Тест отправлен в Telegram")}><Bot className={styles.quickIcon} size={17} /><b>Проверить бота</b><small>Тестовое сообщение прямо админу</small></button>
              <button className={styles.quick} onClick={() => void copyIncident()}><Copy className={styles.quickIcon} size={17} /><b>Incident bundle</b><small>Релиз, метрики, alerts и ошибки в буфер</small></button>
              <Link className={styles.quick} href="/admin/legacy"><Wrench className={styles.quickIcon} size={17} /><b>Legacy tools</b><small>Редкие старые формы и расширенные операции</small></Link>
              <button className={styles.quick} onClick={() => setTab("content")}><Boxes className={styles.quickIcon} size={17} /><b>Контент</b><small>Мгновенно выключить кейс или товар</small></button>
            </div></div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}><Activity size={14} /><h2>Живая активность</h2><p>{data.activity.length} событий</p></div>
            <div className={styles.list}>{data.activity.length ? data.activity.slice(0, 12).map((item) => <div className={styles.row} key={item.id}>
              <div><div className={styles.rowTitle}><span className={styles.activityKind}>{item.kind}</span>{item.amount != null ? `${Number(item.amount).toLocaleString("ru-RU")} TON` : "Событие рынка"}</div><div className={styles.rowSub}>importance {item.importance} · {date(item.created_at)}</div></div><div className={styles.rowMeta}>{ago(item.created_at)}</div>
            </div>) : <div className={styles.empty}>Событий нет</div>}</div>
          </section>
        </div>

        <aside className={styles.stack}>
          <RuntimeControls data={data} busy={busy} action={action} />
          <section className={styles.card}>
            <div className={styles.cardHead}><Shield size={14} /><h2>Последний Gift Sync</h2></div>
            <div className={styles.cardBody}>{data.latestGiftSync ? <div className={styles.release}>
              <Info label="Статус" value={data.latestGiftSync.status} />
              <Info label="Получено" value={String(data.latestGiftSync.unique_received || 0)} />
              <Info label="Импорт" value={String(data.latestGiftSync.unique_imported || 0)} />
              <Info label="Assets" value={String(data.latestGiftSync.assets_updated || 0)} />
              <Info label="Когда" value={date(data.latestGiftSync.finished_at || data.latestGiftSync.started_at)} />
              {data.latestGiftSync.error_message ? <div className={styles.dangerText}>{data.latestGiftSync.error_message}</div> : null}
            </div> : <div className={styles.empty}>Нет запусков</div>}</div>
          </section>
        </aside>
      </div> : null}

      {tab === "players" ? <div className={styles.grid}>
        <div className={styles.stack}>
          <section className={styles.card}><div className={styles.cardHead}><Users size={14} /><h2>Игроки</h2><p>{data.metrics.users} аккаунтов</p></div>
            <div className={styles.cardBody}><div className={styles.searchBox}><Search size={14} /><input value={query} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} placeholder="@username, Telegram ID или имя" /></div>
              <div className={styles.actions}><span className={styles.chip}>{data.metrics.bannedUsers} заблокировано</span><span className={styles.chip}>+{data.metrics.newUsers24h} за 24ч</span></div>
            </div>
          </section>
          <section className={styles.card}><div className={styles.cardHead}><ShieldAlert size={14} /><h2>Reversal queue</h2><p>{data.reversals.length}</p></div>
            <div className={styles.list}>{data.reversals.length ? data.reversals.map((item) => <div className={styles.row} key={item.purchase_id}><div><div className={styles.rowTitle}>{item.product_sku} · {item.status}</div><div className={styles.rowSub}>{item.profile_id} · {date(item.created_at)}</div></div><Link href="/admin/legacy" className={styles.miniButton}>Разобрать</Link></div>) : <div className={styles.empty}>Очередь возвратов чистая</div>}</div>
          </section>
        </div>
        <aside className={styles.card}><div className={styles.cardHead}><Bell size={14} /><h2>Уведомления</h2></div><div className={styles.cardBody}>
          <p className={styles.rowSub}>Массовая отправка создаёт нормальные уведомления в очереди MemeX. Telegram delivery обрабатывается существующим пайплайном.</p>
          <div className={styles.actions}><button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => setBroadcastOpen(true)}><Megaphone size={12} />Новый broadcast</button></div>
        </div></aside>
      </div> : null}

      {tab === "economy" ? <div className={styles.grid}>
        <div className={styles.stack}>
          <section className={styles.card}><div className={styles.cardHead}><SlidersHorizontal size={14} /><h2>Параметры экономики</h2><p>изменения сразу на сервере</p></div><div className={styles.cardBody}>
            {economy ? <><div className={styles.formGrid}>{economyFields.map((field) => <div className={styles.field} key={field.key}><label>{field.label} · {field.hint}</label><input className={styles.input} inputMode="decimal" value={economyDraft[field.key] ?? ""} onChange={(event) => setEconomyDraft((current) => ({ ...current, [field.key]: event.target.value }))} /></div>)}</div>
              <div className={styles.actions}><button disabled={busy !== null} onClick={() => void saveEconomy()} className={`${styles.button} ${styles.buttonPrimary}`}><Settings2 size={12} />Сохранить</button><button className={styles.button} onClick={() => void loadEconomy()}>Сбросить</button></div></> : <div className={styles.empty}>Загрузка экономики…</div>}
          </div></section>
          <section className={styles.card}><div className={styles.cardHead}><Gauge size={14} /><h2>Economy telemetry · 7d</h2></div><div className={styles.cardBody}><pre className={styles.code}>{JSON.stringify(data.economy, null, 2)}</pre></div></section>
        </div>
        <aside className={styles.stack}><section className={styles.card}><div className={styles.cardHead}><CircleDollarSign size={14} /><h2>Stars сегодня</h2></div><div className={styles.cardBody}><div className={styles.profileStats}>
          <Stat label="Paid" value={compact(data.metrics.stars24h)} /><Stat label="Refund" value={compact(data.metrics.refundedStars24h)} /><Stat label="Net" value={compact(data.metrics.netStars24h)} /><Stat label="Reversal" value={compact(data.metrics.reversalQueue)} />
        </div></div></section><RuntimeControls data={data} busy={busy} action={action} compactOnly /></aside>
      </div> : null}

      {tab === "content" ? <div className={styles.contentGrid}>
        <section className={styles.card}><div className={styles.cardHead}><Store size={14} /><h2>Store products</h2><p>{data.products.filter((item) => item.active).length}/{data.products.length}</p></div><div className={`${styles.list} ${styles.scroll}`}>{data.products.map((item) => <div className={styles.row} key={item.sku}><div><div className={styles.rowTitle}>{item.title}</div><div className={styles.rowSub}>{item.sku} · {item.category} · {item.stars_price} Stars</div></div><button disabled={busy !== null} title={item.active ? "Выключить" : "Включить"} className={`${styles.toggle} ${item.active ? styles.toggleOn : ""}`} onClick={() => void action("store.toggle", { sku: item.sku, active: !item.active }, `${item.title}: ${item.active ? "выключен" : "включён"}`)} /></div>)}</div></section>
        <section className={styles.card}><div className={styles.cardHead}><Box size={14} /><h2>Cases</h2><p>{data.cases.filter((item) => item.active).length}/{data.cases.length}</p></div><div className={`${styles.list} ${styles.scroll}`}>{data.cases.map((item) => <div className={styles.row} key={item.sku}><div><div className={styles.rowTitle}>{item.title}</div><div className={styles.rowSub}>{item.sku} · {item.tier} · тираж {item.remaining_supply ?? "∞"}</div></div><button disabled={busy !== null} className={`${styles.toggle} ${item.active ? styles.toggleOn : ""}`} onClick={() => void action("case.toggle", { sku: item.sku, active: !item.active }, `${item.title}: ${item.active ? "выключен" : "включён"}`)} /></div>)}</div></section>
      </div> : null}

      {tab === "system" ? <div className={styles.grid}>
        <div className={styles.stack}>
          <RuntimeControls data={data} busy={busy} action={action} />
          <section className={styles.card}><div className={styles.cardHead}><AlertTriangle size={14} /><h2>Ошибки 24ч</h2><p>{data.errors.length} групп</p></div><div className={styles.list}>{data.errors.length ? data.errors.map((item) => <div className={styles.row} key={item.id}><div><div className={styles.rowTitle}>{item.error_name} · {item.route}</div><div className={styles.rowSub}>{item.message}</div></div><div className={styles.rowMeta}>×{item.count}<br />{ago(item.last_seen_at)}</div></div>) : <div className={styles.empty}>Свежих ошибок нет</div>}</div></section>
          <section className={styles.card}><div className={styles.cardHead}><Hash size={14} /><h2>Audit log</h2><p>последние операции</p></div><div className={styles.list}>{data.audit.map((item) => <div className={styles.row} key={item.id}><div><div className={styles.rowTitle}>{item.action}</div><div className={styles.rowSub}>{item.actor} · {item.target_type || "system"} {item.target_id || ""}</div></div><div className={styles.rowMeta}>{ago(item.created_at)}</div></div>)}</div></section>
        </div>
        <aside className={styles.stack}>
          <section className={styles.card}><div className={styles.cardHead}><TerminalSquare size={14} /><h2>Release</h2></div><div className={styles.cardBody}><div className={styles.release}>
            <Info label="Environment" value={data.release.environment} /><Info label="Commit" value={data.release.commit || "—"} /><Info label="Region" value={data.release.region || "—"} /><Info label="URL" value={data.release.url || "—"} /><Info label="Snapshot" value={date(data.checkedAt)} />
          </div><div className={styles.actions}><button onClick={() => void copyIncident()} className={styles.button}><Copy size={12} />Incident bundle</button>{data.release.url ? <a className={styles.button} target="_blank" rel="noreferrer" href={`https://${data.release.url}`}><ExternalLink size={12} />Deployment</a> : null}</div></div></section>
          <section className={styles.card}><div className={styles.cardHead}><Bot size={14} /><h2>Интеграции</h2></div><div className={styles.cardBody}>
            <div className={styles.switchRows}><div className={styles.switchRow}><Bot size={13} /><div className={styles.switchText}><b>Telegram Bot API</b><small>Проверка прямым сообщением текущему админу</small></div><button disabled={busy !== null} onClick={() => void action("telegram.test", {}, "Telegram отвечает")} className={styles.miniButton}>Тест</button></div>
              <div className={styles.switchRow}><Gift size={13} /><div className={styles.switchText}><b>Gift Catalog</b><small>{data.latestGiftSync ? `${data.latestGiftSync.status} · ${ago(data.latestGiftSync.finished_at || data.latestGiftSync.started_at)}` : "Нет sync run"}</small></div><Link className={styles.miniButton} href="/admin/legacy">Управлять</Link></div>
              <div className={styles.switchRow}><Package size={13} /><div className={styles.switchText}><b>Catalog integrity</b><small>Store + cases server check</small></div><span className={styles.status}>live</span></div>
            </div>
          </div></section>
        </aside>
      </div> : null}

      <footer className={styles.footer}><span>MemeX Ops · server-auth admin surface</span><span>Последнее обновление {date(data.checkedAt)}</span></footer>
    </div>

    {selected?.type === "profile" ? <ProfileDrawer result={selected} grant={grant} setGrant={setGrant} directNotice={directNotice} setDirectNotice={setDirectNotice} busy={busy} action={action} onClose={() => setSelected(null)} setSelected={setSelected} /> : null}

    {broadcastOpen ? <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setBroadcastOpen(false); }}><div className={styles.modal}>
      <div className={styles.modalHead}><Megaphone size={15} /><h2>Broadcast</h2><button className={styles.iconButton} onClick={() => setBroadcastOpen(false)}><X size={14} /></button></div>
      <div className={styles.formGrid}><div className={styles.field}><label>Аудитория</label><select className={styles.select} value={broadcast.audience} onChange={(event) => setBroadcast((current) => ({ ...current, audience: event.target.value }))}><option value="active7d">Активные 7 дней</option><option value="all">Все не забаненные</option><option value="premium">Premium</option><option value="referrers">Рефереры</option></select></div><div className={styles.field}><label>Переход</label><input className={styles.input} value={broadcast.href} onChange={(event) => setBroadcast((current) => ({ ...current, href: event.target.value }))} /></div></div>
      <div className={`${styles.field} mt-2`}><label>Заголовок</label><input className={styles.input} value={broadcast.title} onChange={(event) => setBroadcast((current) => ({ ...current, title: event.target.value }))} maxLength={120} /></div>
      <div className={`${styles.field} mt-2`}><label>Сообщение</label><textarea className={styles.textarea} value={broadcast.body} onChange={(event) => setBroadcast((current) => ({ ...current, body: event.target.value }))} maxLength={1000} /></div>
      <div className={styles.actions}><button disabled={busy !== null || !broadcast.title.trim() || !broadcast.body.trim()} className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => void action("notification.broadcast", broadcast, "Broadcast создан").then(() => { setBroadcastOpen(false); setBroadcast({ audience: "active7d", title: "", body: "", href: "/hub" }); })}><Megaphone size={12} />Отправить</button><button className={styles.button} onClick={() => setBroadcastOpen(false)}>Отмена</button></div>
    </div></div> : null}

    {toast ? <div className={`${styles.toast} ${toast.error ? styles.errorToast : ""}`}>{toast.text}</div> : null}
  </main>;
}

function RuntimeControls({ data, busy, action, compactOnly = false }: { data: OpsSnapshot; busy: string | null; action: (name: string, payload?: Record<string, unknown>, success?: string) => Promise<Record<string, unknown>>; compactOnly?: boolean }) {
  const flags = data.runtime.featureFlags;
  return <section className={styles.card}><div className={styles.cardHead}><Settings2 size={14} /><h2>{compactOnly ? "Kill switches" : "Runtime controls"}</h2><p>{data.runtime.maintenanceMode ? "maintenance" : "online"}</p></div><div className={styles.cardBody}><div className={styles.switchRows}>
    {!compactOnly ? <div className={styles.switchRow}><ShieldAlert size={13} /><div className={styles.switchText}><b>Maintenance</b><small>Закрыть пользовательские операции</small></div><button disabled={busy !== null} className={`${styles.toggle} ${styles.toggleDanger} ${data.runtime.maintenanceMode ? styles.toggleOn : ""}`} onClick={() => void action("runtime.maintenance", { enabled: !data.runtime.maintenanceMode, message: data.runtime.maintenanceMessage }, data.runtime.maintenanceMode ? "Maintenance выключен" : "Maintenance включён")} /></div> : null}
    {(["gifts","memecoins","stars","referrals"] as const).map((feature) => <div className={styles.switchRow} key={feature}><Zap size={13} /><div className={styles.switchText}><b>{feature}</b><small>feature flag</small></div><button disabled={busy !== null} className={`${styles.toggle} ${flags[feature] ? styles.toggleOn : ""}`} onClick={() => void action("runtime.feature", { feature, enabled: !flags[feature] }, `${feature}: ${flags[feature] ? "off" : "on"}`)} /></div>)}
  </div></div></section>;
}

function ProfileDrawer({ result, grant, setGrant, directNotice, setDirectNotice, busy, action, onClose, setSelected }: {
  result: SearchResult;
  grant: { balanceDelta: string; mxmDelta: string; energyDelta: string; xpDelta: string; reason: string };
  setGrant: React.Dispatch<React.SetStateAction<{ balanceDelta: string; mxmDelta: string; energyDelta: string; xpDelta: string; reason: string }>>;
  directNotice: { title: string; body: string; href: string };
  setDirectNotice: React.Dispatch<React.SetStateAction<{ title: string; body: string; href: string }>>;
  busy: string | null;
  action: (name: string, payload?: Record<string, unknown>, success?: string) => Promise<Record<string, unknown>>;
  onClose: () => void;
  setSelected: React.Dispatch<React.SetStateAction<SearchResult | null>>;
}) {
  const meta = result.meta;
  const banned = Boolean(meta.is_banned);
  const hidden = Boolean(meta.hidden_from_leaderboard);
  const submitGrant = async () => {
    const payload = { profileId: result.id, balanceDelta: Number(grant.balanceDelta || 0), mxmDelta: Number(grant.mxmDelta || 0), energyDelta: Number(grant.energyDelta || 0), xpDelta: Number(grant.xpDelta || 0), reason: grant.reason };
    try {
      const response = await action("profile.grant", payload, "Ресурсы изменены");
      const value = response.result as { after?: Record<string, unknown> } | undefined;
      if (value?.after) setSelected((current) => current ? { ...current, meta: { ...current.meta, balance: value.after?.balance, mxm_coins: value.after?.mxm, energy: value.after?.energy, xp: value.after?.xp } } : current);
      setGrant({ balanceDelta: "", mxmDelta: "", energyDelta: "", xpDelta: "", reason: "" });
    } catch {}
  };
  return <><div className={styles.drawerBackdrop} onClick={onClose} /><aside className={styles.drawer}>
    <div className={styles.drawerHead}><div className={styles.resultIcon}><UserRound size={15} /></div><div className="min-w-0 flex-1"><h2 className="truncate">{result.title}</h2><p>{result.id}</p></div><button className={styles.iconButton} onClick={onClose}><X size={14} /></button></div>
    <div className={styles.profileStats}><Stat label="TON" value={Number(meta.balance || 0).toLocaleString("ru-RU")} /><Stat label="MXM" value={Number(meta.mxm_coins || 0).toLocaleString("ru-RU")} /><Stat label="Energy" value={`${meta.energy ?? 0}/${meta.max_energy ?? 0}`} /><Stat label="XP" value={Number(meta.xp || 0).toLocaleString("ru-RU")} /></div>

    <section className={styles.drawerSection}><h3>Ресурсы</h3><div className={styles.formGrid}><Field label="TON Δ" value={grant.balanceDelta} onChange={(value) => setGrant((current) => ({ ...current, balanceDelta: value }))} /><Field label="MXM Δ" value={grant.mxmDelta} onChange={(value) => setGrant((current) => ({ ...current, mxmDelta: value }))} /><Field label="Energy Δ" value={grant.energyDelta} onChange={(value) => setGrant((current) => ({ ...current, energyDelta: value }))} /><Field label="XP Δ" value={grant.xpDelta} onChange={(value) => setGrant((current) => ({ ...current, xpDelta: value }))} /></div><div className={`${styles.field} mt-2`}><label>Причина</label><input className={styles.input} value={grant.reason} onChange={(event) => setGrant((current) => ({ ...current, reason: event.target.value }))} placeholder="почему меняем баланс" /></div><div className={styles.actions}><button disabled={busy !== null} onClick={() => void submitGrant()} className={`${styles.button} ${styles.buttonPrimary}`}><Sparkles size={12} />Применить</button></div></section>

    <section className={styles.drawerSection}><h3>Модерация</h3><div className={styles.actions}><button disabled={busy !== null} className={`${styles.button} ${banned ? "" : styles.buttonDanger}`} onClick={() => void action("profile.moderate", { profileId: result.id, isBanned: !banned, banReason: banned ? "" : "MemeX Ops moderation" }, banned ? "Игрок разблокирован" : "Игрок заблокирован").then(() => setSelected((current) => current ? { ...current, meta: { ...current.meta, is_banned: !banned } } : current))}>{banned ? <Shield size={12} /> : <ShieldAlert size={12} />}{banned ? "Разбанить" : "Забанить"}</button><button disabled={busy !== null} className={styles.button} onClick={() => void action("profile.moderate", { profileId: result.id, hiddenFromLeaderboard: !hidden }, hidden ? "Вернули в рейтинг" : "Скрыли из рейтинга").then(() => setSelected((current) => current ? { ...current, meta: { ...current.meta, hidden_from_leaderboard: !hidden } } : current))}>{hidden ? "Вернуть в рейтинг" : "Скрыть из рейтинга"}</button></div></section>

    <section className={styles.drawerSection}><h3>Личное уведомление</h3><div className={styles.field}><label>Заголовок</label><input className={styles.input} value={directNotice.title} onChange={(event) => setDirectNotice((current) => ({ ...current, title: event.target.value }))} /></div><div className={`${styles.field} mt-2`}><label>Текст</label><textarea className={styles.textarea} value={directNotice.body} onChange={(event) => setDirectNotice((current) => ({ ...current, body: event.target.value }))} /></div><div className={`${styles.field} mt-2`}><label>Href</label><input className={styles.input} value={directNotice.href} onChange={(event) => setDirectNotice((current) => ({ ...current, href: event.target.value }))} /></div><div className={styles.actions}><button disabled={busy !== null || !directNotice.title.trim() || !directNotice.body.trim()} className={styles.button} onClick={() => void action("notification.send", { profileId: result.id, ...directNotice }, "Уведомление создано").then(() => setDirectNotice({ title: "", body: "", href: "/hub" }))}><Bell size={12} />Отправить</button><Link href={result.href} className={styles.button}><ExternalLink size={12} />Профиль</Link></div></section>
  </aside></>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <div className={styles.field}><label>{label}</label><input inputMode="decimal" className={styles.input} value={value} onChange={(event) => onChange(event.target.value)} placeholder="0" /></div>; }
function Stat({ label, value }: { label: string; value: string }) { return <div className={styles.profileStat}><small>{label}</small><b>{value}</b></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className={styles.releaseRow}><span>{label}</span><b>{value}</b></div>; }
