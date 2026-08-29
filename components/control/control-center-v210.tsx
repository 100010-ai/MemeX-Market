"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Ban, BellRing, Boxes, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign,
  Coins, Command, Database, Gauge, Gift, KeyRound, ListChecks, LoaderCircle, LockKeyhole,
  LogOut, Megaphone, PanelLeftClose, Radio, RefreshCw, Search, Settings2, ShieldAlert,
  ShieldCheck, Sparkles, Star, ToggleLeft, ToggleRight, TrendingUp, UserRoundCheck, Users, Wrench,
} from "lucide-react";
import { BroadcastComposer } from "@/components/control/broadcast-composer";
import { DonutChart, TrendChart, type DonutItem, type TrendPoint } from "@/components/control/control-charts";

type SessionInfo = { available: boolean; authenticated: boolean; authMode: "telegram_otp" | "local_token"; adminTelegramId?: string | null };
type MetricSnapshot = {
  players: number; active7d: number; active30d: number; new7d: number; banned: number; activeCoins: number;
  listedGifts: number; giftVolume24h: number; coinVolume24h: number; stars24h: number; errors24h: number;
  openCoinOrders: number; pendingStars: number;
};
type Dashboard = {
  snapshot: {
    days: number;
    generatedAt: string;
    metrics: MetricSnapshot;
    series: Array<{ date: string; newPlayers: number; activePlayers: number; giftTrades: number; giftVolume: number; coinTrades: number; coinVolume: number; stars: number }>;
    distributions: { players: DonutItem[]; gifts: DonutItem[]; coins: DonutItem[]; stars: DonutItem[]; catalog: DonutItem[] };
    mediaHealth: { total: number; missing: number; verified: number; unverified_tonapi: number };
    topCollections: Array<{ base_name: string; item_count: number; holder_count: number; listed_count: number; floor_price: number; volume_24h: number; trade_count_24h: number; change_24h: number }>;
  };
  runtimeConfig: RuntimeConfig;
  schemaHealth: { ready: boolean; schemaVersion: number; requiredSchemaVersion: number; missingRequired: string[]; missingOptional: string[]; capabilities: Array<{ key: string; label: string; required: boolean; ok: boolean; code: string | null }> };
  latestErrors: Array<{ route: string; error_name: string; message: string; count: number; affected_users: number; last_seen_at: string }>;
  recentGiftSyncs: Array<Record<string, any>>;
  recentBroadcasts: Array<Record<string, any>>;
  checkedAt: string;
};
type RuntimeConfig = {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  featureFlags: { gifts: boolean; memecoins: boolean; referrals: boolean; stars: boolean };
  remoteConfig: { maxPriceAlerts: number; maxWatchlistItems: number; marketPageSize: number; coinOrderMaxOpen: number; coinOrderMaxDays: number };
  updatedAt: string;
};
type DataPayload = { section: string; rows: Array<Record<string, any>>; total: number; offset: number; limit: number; checkedAt: string };
type Tab = "overview" | "players" | "gifts" | "coins" | "broadcasts" | "missions" | "stars" | "catalog" | "system" | "audit";
type ModalState = null | { kind: "balance" | "xp" | "giftPrice"; row: Record<string, any> };

const PAGE_SIZE = 60;
const sectionTabs = new Set<Tab>(["players", "gifts", "coins", "missions", "stars", "catalog", "audit"]);

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Ошибка ${response.status}`);
  return body as T;
}
function n(value: unknown) { const result = Number(value || 0); return Number.isFinite(result) ? result : 0; }
function money(value: unknown) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n(value)); }
function compact(value: unknown) { return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(n(value)); }
function date(value: unknown) { if (!value) return "—"; const parsed = new Date(String(value)); return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function label(name: string) {
  const map: Record<string, string> = { active_7d: "Активны 7д", inactive_7d: "Неактивны 7д", owned: "В коллекциях", listed: "Выставлены", active: "Активные", dead: "Мёртвые", graduated: "Graduated", hidden: "Скрытые", paid: "Оплачено", pending: "Ожидают", refunded: "Возвраты", tonapi: "TonAPI", profile_sync: "Профили", bot_catalog: "Bot API", unknown: "Неизвестно" };
  return map[name] || name;
}
function translated(items: DonutItem[] | undefined) { return (items || []).map((item) => ({ ...item, name: label(String(item.name)) })); }

export function ControlCenterV210() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [telegramId, setTelegramId] = useState("");
  const [code, setCode] = useState("");
  const [localToken, setLocalToken] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<DataPayload | null>(null);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [loadingSection, setLoadingSection] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const dashboardAbort = useRef<AbortController | null>(null);
  const sectionAbort = useRef<AbortController | null>(null);
  const sectionCache = useRef(new Map<string, { at: number; payload: DataPayload }>());
  const searchRef = useRef<HTMLInputElement>(null);

  const checkSession = useCallback(async () => {
    try { setSession(await request<SessionInfo>("/api/control/session")); }
    catch { setSession({ available: false, authenticated: false, authMode: "local_token" }); }
  }, []);

  const loadDashboard = useCallback(async (force = false) => {
    if (!session?.authenticated) return;
    if (!force && dashboard && Date.now() - new Date(dashboard.checkedAt).getTime() < 8_000) return;
    dashboardAbort.current?.abort();
    const controller = new AbortController(); dashboardAbort.current = controller;
    setLoadingDashboard(true); setError(null);
    try {
      const payload = await request<Dashboard>(`/api/control/dashboard?days=${days}`, { signal: controller.signal });
      setDashboard(payload);
    } catch (cause) {
      if ((cause as Error)?.name !== "AbortError") setError(cause instanceof Error ? cause.message : "Dashboard не загрузился");
    } finally { if (dashboardAbort.current === controller) setLoadingDashboard(false); }
  }, [session?.authenticated, dashboard, days]);

  const loadSection = useCallback(async (section: Tab, force = false, q = query, pageOffset = offset) => {
    if (!session?.authenticated || !sectionTabs.has(section)) return;
    const key = `${section}:${q.trim()}:${pageOffset}`;
    const cached = sectionCache.current.get(key);
    if (!force && cached && Date.now() - cached.at < 6_000) { setData(cached.payload); return; }
    sectionAbort.current?.abort();
    const controller = new AbortController(); sectionAbort.current = controller;
    setLoadingSection(true); setError(null);
    try {
      const payload = await request<DataPayload>(`/api/control/data?section=${section}&limit=${PAGE_SIZE}&offset=${pageOffset}&q=${encodeURIComponent(q.trim())}`, { signal: controller.signal });
      sectionCache.current.set(key, { at: Date.now(), payload });
      if (sectionAbort.current === controller) setData(payload);
    } catch (cause) {
      if ((cause as Error)?.name !== "AbortError") setError(cause instanceof Error ? cause.message : "Раздел не загрузился");
    } finally { if (sectionAbort.current === controller) setLoadingSection(false); }
  }, [session?.authenticated, query, offset]);

  useEffect(() => { void checkSession(); }, [checkSession]);
  useEffect(() => { if (session?.authenticated) void loadDashboard(true); }, [session?.authenticated, days]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!session?.authenticated || !sectionTabs.has(tab)) { setData(null); return; }
    const timer = window.setTimeout(() => void loadSection(tab, false, query, offset), query.trim() ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [tab, query, offset, session?.authenticated]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === "Escape") { setModal(null); setQuery(""); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadDashboard(true); }, 20_000);
    return () => window.clearInterval(timer);
  }, [session?.authenticated, loadDashboard]);

  async function requestCode(event: FormEvent) {
    event.preventDefault(); setBusy("request-code"); setError(null); setNotice(null);
    try { await request("/api/control/session", { method: "POST", body: JSON.stringify({ action: "request_code", telegramId }) }); setCodeRequested(true); setNotice("Код отправлен ботом в Telegram"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Код не отправлен"); }
    finally { setBusy(null); }
  }
  async function verifyCode(event: FormEvent) {
    event.preventDefault(); setBusy("verify-code"); setError(null);
    try { await request("/api/control/session", { method: "POST", body: JSON.stringify({ action: "verify_code", telegramId, code }) }); await checkSession(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Вход не выполнен"); }
    finally { setBusy(null); }
  }
  async function loginLocal(event: FormEvent) {
    event.preventDefault(); setBusy("local-login"); setError(null);
    try { await request("/api/control/session", { method: "POST", body: JSON.stringify({ token: localToken }) }); await checkSession(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Вход не выполнен"); }
    finally { setBusy(null); }
  }
  async function logout() { await request("/api/control/session", { method: "DELETE" }).catch(() => null); setSession((current) => current ? { ...current, authenticated: false } : current); setDashboard(null); setData(null); }

  async function runAction(action: string, payload: Record<string, unknown> = {}, optimistic?: () => void) {
    const key = `${action}:${String(payload.id || payload.profileId || "")}`;
    setBusy(key); setError(null); setNotice(null);
    try {
      await request("/api/control/action", { method: "POST", body: JSON.stringify({ action, ...payload }) });
      optimistic?.();
      setNotice("Изменение применено");
      sectionCache.current.clear();
      if (sectionTabs.has(tab)) void loadSection(tab, true);
      void loadDashboard(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Операция не выполнена"); }
    finally { setBusy(null); }
  }
  async function runOp(action: string, payload: Record<string, unknown> = {}) {
    setBusy(action); setError(null); setNotice(null);
    try { await request("/api/control/ops", { method: "POST", body: JSON.stringify({ action, ...payload }) }); setNotice("Системная операция выполнена"); void loadDashboard(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Операция не выполнена"); }
    finally { setBusy(null); }
  }

  if (!session) return <ScreenLoading text="Проверяем Control Center"/>;
  if (!session.available) return <Gate/>;
  if (!session.authenticated) return <Login session={session} telegramId={telegramId} setTelegramId={setTelegramId} code={code} setCode={setCode} localToken={localToken} setLocalToken={setLocalToken} codeRequested={codeRequested} requestCode={requestCode} verifyCode={verifyCode} loginLocal={loginLocal} busy={busy} error={error} notice={notice}/>;

  const nav: Array<[Tab, string, typeof Gauge]> = [
    ["overview", "Обзор", Gauge], ["players", "Игроки", Users], ["gifts", "Gifts", Gift], ["coins", "Мемкоины", Coins],
    ["broadcasts", "Рассылки", Megaphone], ["missions", "Задания", ListChecks], ["stars", "Stars", Star], ["catalog", "Каталог", Database],
    ["system", "Система", Settings2], ["audit", "Аудит", ShieldCheck],
  ];
  const m = dashboard?.snapshot.metrics;
  const counts: Partial<Record<Tab, number>> = { players: m?.players, gifts: m?.listedGifts, coins: m?.activeCoins, audit: m?.errors24h };

  return <div className="control-root min-h-[100dvh] bg-[#060708] text-white">
    <aside className={`control-sidebar transition-[width] duration-150 ${sidebarCollapsed ? "!w-[68px]" : ""}`}>
      <div className="flex items-center gap-2 px-2 py-2"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-white text-[10px] font-black tracking-[-.08em] text-black">MXM</div>{!sidebarCollapsed ? <div className="min-w-0"><div className="truncate text-[12px] font-semibold">Control Center</div><div className="text-[8px] tracking-[.13em] text-white/30">OPERATOR V2.1</div></div> : null}<button onClick={() => setSidebarCollapsed((value) => !value)} className="ml-auto grid h-7 w-7 place-items-center rounded-[9px] text-white/30 hover:bg-white/[.05] hover:text-white/70"><PanelLeftClose size={13} className={sidebarCollapsed ? "rotate-180" : ""}/></button></div>
      <nav className="mt-4 space-y-1">{nav.map(([key, title, Icon]) => <button key={key} onClick={() => { setTab(key); setOffset(0); setQuery(""); }} className={`control-nav ${tab === key ? "control-nav-active" : ""}`} title={sidebarCollapsed ? title : undefined}><Icon size={15} className="shrink-0"/><span className={sidebarCollapsed ? "hidden" : "min-w-0 flex-1 truncate"}>{title}</span>{!sidebarCollapsed && counts[key] != null ? <small className="control-nav-count">{counts[key]}</small> : null}</button>)}</nav>
      <div className="mt-auto space-y-2">{!sidebarCollapsed ? <div className="rounded-[14px] border border-white/[.055] bg-white/[.02] p-3 text-[8px] leading-4 text-white/30"><ShieldCheck size={12} className="mb-1 text-[var(--positive)]"/>Browser session<br/>Telegram OTP<br/>HttpOnly · 8h</div> : null}<button onClick={() => void logout()} className="control-nav"><LogOut size={14}/><span className={sidebarCollapsed ? "hidden" : ""}>Выйти</span></button></div>
    </aside>

    <main className={`control-main transition-[margin] duration-150 ${sidebarCollapsed ? "!ml-[68px]" : ""}`}>
      <header className="control-topbar sticky top-0 z-10 -mx-2 mb-3 border-b border-white/[.045] bg-[#060708]/95 px-2 py-2 backdrop-blur-xl">
        <div className="min-w-0"><h1 className="truncate text-[14px] font-semibold">{nav.find(([key]) => key === tab)?.[1]}</h1><p className="mt-0.5 text-[8px] text-white/25">{dashboard ? `обновлено ${date(dashboard.checkedAt)}` : "загрузка"}</p></div>
        {sectionTabs.has(tab) ? <label className="control-search ml-auto !w-full max-w-[420px]"><Search size={13}/><input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="Поиск…"/><kbd className="hidden rounded border border-white/[.08] px-1.5 py-0.5 text-[8px] text-white/25 sm:inline">Ctrl K</kbd></label> : <div className="ml-auto"/>}
        <button disabled={loadingDashboard || loadingSection} onClick={() => { if (sectionTabs.has(tab)) void loadSection(tab, true); else void loadDashboard(true); }} className="control-icon" title="Обновить"><RefreshCw size={14} className={loadingDashboard || loadingSection ? "animate-spin" : ""}/></button>
      </header>

      {error ? <div className="control-alert control-alert-error">{error}</div> : null}
      {notice ? <div className="control-alert control-alert-ok">{notice}</div> : null}

      {tab === "overview" ? <Overview dashboard={dashboard} days={days} setDays={setDays} busy={busy} runAction={runAction} runOp={runOp}/> : null}
      {tab === "players" ? <Players payload={data} loading={loadingSection} busy={busy} runAction={runAction} openModal={setModal}/> : null}
      {tab === "gifts" ? <GiftsPanel payload={data} loading={loadingSection} busy={busy} runAction={runAction} openModal={setModal}/> : null}
      {tab === "coins" ? <CoinsPanel payload={data} loading={loadingSection} busy={busy} runAction={runAction}/> : null}
      {tab === "broadcasts" ? <BroadcastComposer/> : null}
      {tab === "missions" ? <MissionsPanel payload={data} loading={loadingSection} busy={busy} runAction={runAction}/> : null}
      {tab === "stars" ? <StarsPanel payload={data} loading={loadingSection}/> : null}
      {tab === "catalog" ? <CatalogPanel payload={data} loading={loadingSection} busy={busy} runAction={runAction}/> : null}
      {tab === "system" ? <SystemPanel dashboard={dashboard} busy={busy} runAction={runAction} runOp={runOp} refresh={() => void loadDashboard(true)}/> : null}
      {tab === "audit" ? <AuditPanel payload={data} loading={loadingSection}/> : null}

      {sectionTabs.has(tab) && data ? <Pagination payload={data} offset={offset} setOffset={setOffset}/> : null}
    </main>
    {modal ? <ActionModal modal={modal} close={() => setModal(null)} runAction={runAction}/> : null}
  </div>;
}

function Login(props: { session: SessionInfo; telegramId: string; setTelegramId: (v: string) => void; code: string; setCode: (v: string) => void; localToken: string; setLocalToken: (v: string) => void; codeRequested: boolean; requestCode: (e: FormEvent) => Promise<void>; verifyCode: (e: FormEvent) => Promise<void>; loginLocal: (e: FormEvent) => Promise<void>; busy: string | null; error: string | null; notice: string | null }) {
  if (props.session.authMode === "telegram_otp") return <div className="control-root grid min-h-[100dvh] place-items-center p-5"><form onSubmit={props.codeRequested ? props.verifyCode : props.requestCode} className="w-full max-w-[430px] rounded-[22px] border border-white/[.07] bg-[#0b0e12] p-6 shadow-2xl"><div className="grid h-11 w-11 place-items-center rounded-[14px] bg-white text-black"><KeyRound size={18}/></div><h1 className="mt-5 text-[18px] font-semibold tracking-[-.03em]">MXM Control Center</h1><p className="mt-2 text-[10px] leading-5 text-white/35">Открывается прямо в браузере. Доступ подтверждается одноразовым кодом, который бот отправляет только Telegram ID из списка администраторов.</p>{!props.codeRequested ? <><label className="mt-5 block text-[9px] text-white/35">Ваш Telegram ID<input autoFocus inputMode="numeric" value={props.telegramId} onChange={(event) => props.setTelegramId(event.target.value.replace(/\D/g, "").slice(0, 20))} className="control-input mt-1.5 !min-h-10 !text-[12px]" placeholder="123456789"/></label><button disabled={props.busy === "request-code" || props.telegramId.length < 4} className="control-primary mt-3 w-full">{props.busy === "request-code" ? <LoaderCircle size={13} className="animate-spin"/> : <BellRing size={13}/>}Получить код в Telegram</button></> : <><label className="mt-5 block text-[9px] text-white/35">Код из сообщения бота<input autoFocus inputMode="numeric" value={props.code} onChange={(event) => props.setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="control-input mt-1.5 !min-h-11 !text-center !font-mono !text-[18px] !tracking-[.28em]" placeholder="000000"/></label><button disabled={props.busy === "verify-code" || props.code.length !== 6} className="control-primary mt-3 w-full">{props.busy === "verify-code" ? <LoaderCircle size={13} className="animate-spin"/> : <ShieldCheck size={13}/>}Открыть панель</button><button type="button" onClick={() => window.location.reload()} className="mt-3 w-full text-[9px] text-white/30">Запросить другой код</button></>}{props.error ? <div className="control-alert control-alert-error mt-4">{props.error}</div> : null}{props.notice ? <div className="control-alert control-alert-ok mt-4">{props.notice}</div> : null}<div className="mt-5 flex items-center gap-2 border-t border-white/[.055] pt-4 text-[8px] text-white/25"><LockKeyhole size={11}/>HttpOnly · SameSite Strict · 8 часов</div></form></div>;
  return <div className="control-root grid min-h-[100dvh] place-items-center p-5"><form onSubmit={props.loginLocal} className="w-full max-w-[430px] rounded-[22px] border border-white/[.07] bg-[#0b0e12] p-6"><KeyRound size={20}/><h1 className="mt-4 text-lg font-semibold">Локальный Control Center</h1><input type="password" autoFocus value={props.localToken} onChange={(event) => props.setLocalToken(event.target.value)} className="control-input mt-5" placeholder=".mxm-control-secret"/><button className="control-primary mt-3 w-full">Открыть</button>{props.error ? <div className="control-alert control-alert-error mt-3">{props.error}</div> : null}</form></div>;
}

function Gate() { return <div className="control-root grid min-h-[100dvh] place-items-center p-5"><div className="max-w-md rounded-[20px] border border-white/[.07] bg-[#0b0e12] p-6 text-center"><LockKeyhole size={22} className="mx-auto text-white/50"/><h1 className="mt-3 text-[15px] font-semibold">Control Center не настроен</h1><p className="mt-2 text-[10px] leading-5 text-white/35">Нужны SESSION_SECRET, TELEGRAM_BOT_TOKEN и ADMIN_TELEGRAM_IDS. В dev остаётся локальный режим.</p></div></div>; }
function ScreenLoading({ text }: { text: string }) { return <div className="control-root grid min-h-[100dvh] place-items-center"><div className="flex items-center gap-2 text-[10px] text-white/35"><LoaderCircle size={14} className="animate-spin"/>{text}</div></div>; }

function KPI({ icon, label: title, value, sub, danger }: { icon: ReactNode; label: string; value: string; sub?: string; danger?: boolean }) { return <div className={`rounded-[17px] border p-3.5 ${danger ? "border-[var(--negative)]/25 bg-[var(--negative)]/[.045]" : "border-white/[.065] bg-[#0b0e12]"}`}><div className="flex items-center justify-between text-white/30"><span className="text-[8px] uppercase tracking-[.09em]">{title}</span>{icon}</div><div className="mt-2 text-[19px] font-semibold tracking-[-.04em]">{value}</div>{sub ? <div className="mt-1 text-[8px] text-white/28">{sub}</div> : null}</div>; }

function Overview({ dashboard, days, setDays, busy, runAction, runOp }: { dashboard: Dashboard | null; days: number; setDays: (v: number) => void; busy: string | null; runAction: (a: string, p?: Record<string, unknown>) => Promise<void>; runOp: (a: string, p?: Record<string, unknown>) => Promise<void> }) {
  if (!dashboard) return <ScreenLoading text="Собираем быстрый снимок"/>;
  const { snapshot } = dashboard; const m = snapshot.metrics;
  const series = snapshot.series.map((point) => ({ ...point, date: new Date(point.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) })) as TrendPoint[];
  const media = snapshot.mediaHealth || { total: 0, missing: 0, verified: 0, unverified_tonapi: 0 };
  const mediaOk = Math.max(0, n(media.total) - n(media.missing));
  return <div className="space-y-4 pb-8">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-[13px] font-semibold">Состояние проекта</h2><p className="mt-1 text-[9px] text-white/30">Один агрегированный DB snapshot вместо загрузки сотен строк.</p></div><div className="inline-flex rounded-[11px] border border-white/[.06] bg-[#0b0e12] p-1">{[7,30,90].map((value) => <button key={value} onClick={() => setDays(value)} className={`rounded-[8px] px-2.5 py-1 text-[9px] ${days === value ? "bg-white text-black" : "text-white/35"}`}>{value}д</button>)}</div></div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8"><KPI icon={<Users size={13}/>} label="Игроки" value={compact(m.players)} sub={`${m.new7d} новых · 7д`}/><KPI icon={<Activity size={13}/>} label="Активны 7д" value={compact(m.active7d)} sub={`${m.active30d} за 30д`}/><KPI icon={<Gift size={13}/>} label="Gifts в продаже" value={compact(m.listedGifts)} sub={`${money(m.giftVolume24h)} TON / 24ч`}/><KPI icon={<Coins size={13}/>} label="Мемкоины" value={compact(m.activeCoins)} sub={`${money(m.coinVolume24h)} TON / 24ч`}/><KPI icon={<Star size={13}/>} label="Stars / 24ч" value={compact(m.stars24h)} sub={`${m.pendingStars} pending`}/><KPI icon={<Radio size={13}/>} label="Media health" value={`${media.total ? Math.round((mediaOk / media.total) * 100) : 100}%`} sub={`${media.missing} без preview`} danger={media.missing > 0}/><KPI icon={<ShieldAlert size={13}/>} label="Ошибки / 24ч" value={compact(m.errors24h)} sub={`${dashboard.latestErrors.length} групп`} danger={m.errors24h > 0}/><KPI icon={dashboard.schemaHealth.ready ? <CheckCircle2 size={13}/> : <ShieldAlert size={13}/>} label="Schema" value={dashboard.schemaHealth.ready ? "READY" : "CHECK"} sub={`v${dashboard.schemaHealth.schemaVersion}`} danger={!dashboard.schemaHealth.ready}/></div>
    <div className="grid gap-4 xl:grid-cols-2"><TrendChart title="Аудитория" points={series} series={[{ key: "activePlayers", label: "Активные" }, { key: "newPlayers", label: "Новые", color: "#59d5a1" }]}/><TrendChart title="Оборот рынка" points={series} series={[{ key: "giftVolume", label: "Gifts TON" }, { key: "coinVolume", label: "Memecoins TON", color: "#f2b66d" }]}/></div>
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4"><DonutChart title="Активность игроков" items={translated(snapshot.distributions.players)} centerLabel="игроков"/><DonutChart title="Состояние Gifts" items={translated(snapshot.distributions.gifts)} centerLabel="подарков"/><DonutChart title="Состояние мемкоинов" items={translated(snapshot.distributions.coins)} centerLabel="коинов"/><DonutChart title="Telegram Stars" items={translated(snapshot.distributions.stars)} centerLabel="платежей"/></div>
    <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
      <Panel title="Топ коллекций / 24ч" icon={<TrendingUp size={14}/>}><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-[9px]"><thead className="text-white/25"><tr><th className="pb-2 font-medium">Коллекция</th><th>Floor</th><th>Volume 24h</th><th>Trades</th><th>Listed</th><th>Δ 24h</th></tr></thead><tbody className="divide-y divide-white/[.045]">{snapshot.topCollections.map((row) => <tr key={row.base_name}><td className="py-2.5 font-medium text-white/75">{row.base_name}</td><td>{money(row.floor_price)}</td><td>{money(row.volume_24h)}</td><td>{row.trade_count_24h}</td><td>{row.listed_count}/{row.item_count}</td><td className={n(row.change_24h) >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}>{n(row.change_24h).toFixed(1)}%</td></tr>)}</tbody></table></div></Panel>
      <div className="space-y-4"><Panel title="Быстрые операции" icon={<Sparkles size={14}/>}><div className="grid gap-2"><Quick title="Синхронизировать Gifts" text="TonAPI + каталог" disabled={Boolean(busy)} onClick={() => void runAction("catalog.sync")}/><Quick title="Прогнать NPC liquidity" text="точечное пополнение" disabled={Boolean(busy)} onClick={() => void runAction("npc.tick", { targetListings: 18 })}/><Quick title="Освободить Stars reservations" text="просроченные pending" disabled={Boolean(busy)} onClick={() => void runOp("stars.release_expired")}/></div></Panel><Panel title="Gift media integrity" icon={<Radio size={14}/>}><div className="grid grid-cols-2 gap-2"><Mini label="Всего assets" value={compact(media.total)}/><Mini label="С preview" value={compact(mediaOk)}/><Mini label="Chain verified" value={compact(media.verified)}/><Mini label="TonAPI unverified" value={compact(media.unverified_tonapi)} danger={media.unverified_tonapi > 0}/></div></Panel></div>
    </div>
    <div className="grid gap-4 xl:grid-cols-2"><Panel title="Последние ошибки" icon={<ShieldAlert size={14}/>}><div className="space-y-2">{dashboard.latestErrors.length ? dashboard.latestErrors.map((row) => <div key={`${row.route}-${row.error_name}`} className="rounded-[12px] border border-white/[.05] bg-black/15 p-2.5"><div className="flex gap-2"><span className="min-w-0 flex-1 truncate text-[9px] font-medium">{row.route}</span><span className="text-[8px] text-[var(--negative)]">×{row.count}</span></div><p className="mt-1 line-clamp-2 text-[8px] leading-4 text-white/30">{row.error_name}: {row.message}</p></div>) : <Empty text="Ошибок не зафиксировано"/>}</div></Panel><Panel title="Последние sync Gifts" icon={<RefreshCw size={14}/>}><div className="space-y-2">{dashboard.recentGiftSyncs.length ? dashboard.recentGiftSyncs.map((row) => <div key={row.id} className="flex items-center gap-3 rounded-[12px] border border-white/[.05] bg-black/15 p-2.5"><span className={`h-2 w-2 rounded-full ${row.status === "success" || row.status === "done" ? "bg-[var(--positive)]" : row.status === "failed" ? "bg-[var(--negative)]" : "bg-white/30"}`}/><div className="min-w-0 flex-1"><p className="text-[9px] text-white/70">{row.status}</p><p className="mt-0.5 text-[8px] text-white/25">{row.unique_imported ?? 0} imported · {row.skipped_invalid ?? 0} skipped</p></div><span className="text-[8px] text-white/25">{date(row.started_at)}</span></div>) : <Empty text="Sync runs пока нет"/>}</div></Panel></div>
  </div>;
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) { return <section className="rounded-[18px] border border-white/[.065] bg-[#0b0e12]"><div className="flex items-center gap-2 border-b border-white/[.045] px-4 py-3 text-[10px] font-semibold">{icon}<span>{title}</span></div><div className="p-3.5">{children}</div></section>; }
function Mini({ label: title, value, danger }: { label: string; value: string; danger?: boolean }) { return <div className="rounded-[12px] border border-white/[.05] bg-black/15 p-2.5"><div className="text-[8px] text-white/28">{title}</div><div className={`mt-1 text-[13px] font-semibold ${danger ? "text-[var(--negative)]" : ""}`}>{value}</div></div>; }
function Quick({ title, text, disabled, onClick }: { title: string; text: string; disabled?: boolean; onClick: () => void }) { return <button disabled={disabled} onClick={onClick} className="rounded-[13px] border border-white/[.06] bg-black/15 px-3 py-2.5 text-left transition hover:bg-white/[.035] disabled:opacity-40"><div className="text-[9px] font-medium text-white/75">{title}</div><div className="mt-0.5 text-[8px] text-white/25">{text}</div></button>; }
function Empty({ text }: { text: string }) { return <div className="py-8 text-center text-[9px] text-white/25">{text}</div>; }

function SectionShell({ payload, loading, children }: { payload: DataPayload | null; loading: boolean; children: ReactNode }) { if (!payload && loading) return <div className="grid min-h-[300px] place-items-center text-[9px] text-white/30"><LoaderCircle size={14} className="mr-2 animate-spin"/>Загрузка раздела</div>; return <div className={`rounded-[18px] border border-white/[.065] bg-[#0b0e12] ${loading ? "opacity-70" : ""}`}>{children}</div>; }

function Players({ payload, loading, busy, runAction, openModal }: { payload: DataPayload | null; loading: boolean; busy: string | null; runAction: (a: string, p?: Record<string, unknown>, o?: () => void) => Promise<void>; openModal: (m: ModalState) => void }) {
  const rows = payload?.rows || [];
  return <SectionShell payload={payload} loading={loading}><div className="overflow-x-auto"><table className="w-full min-w-[1060px] text-left text-[9px]"><thead className="border-b border-white/[.05] text-white/25"><tr><Th>Игрок</Th><Th>Balance</Th><Th>Stars</Th><Th>XP</Th><Th>Premium</Th><Th>Gift sync</Th><Th>Статус</Th><Th className="text-right">Действия</Th></tr></thead><tbody className="divide-y divide-white/[.04]">{rows.map((row) => <tr key={row.id} className="hover:bg-white/[.015]"><Td><div className="font-medium text-white/80">{row.username ? `@${row.username}` : `${row.first_name || "User"} ${row.last_name || ""}`.trim()}</div><div className="mt-0.5 font-mono text-[7px] text-white/20">{row.telegram_id}</div></Td><Td>{money(row.balance)} TON</Td><Td>{compact(row.stars_spent)}</Td><Td>{compact(row.xp)}</Td><Td>{row.premium_until && new Date(row.premium_until) > new Date() ? <Badge good>Premium</Badge> : <span className="text-white/25">—</span>}</Td><Td>{date(row.last_gift_sync_at)}</Td><Td><div className="flex gap-1">{row.is_banned ? <Badge danger>ban</Badge> : <Badge good>active</Badge>}{row.hidden_from_leaderboard ? <Badge>hidden</Badge> : null}</div></Td><Td><div className="flex justify-end gap-1"><button disabled={Boolean(busy)} onClick={() => openModal({ kind: "balance", row })} className="control-small"><CircleDollarSign size={11}/>Баланс</button><button disabled={Boolean(busy)} onClick={() => openModal({ kind: "xp", row })} className="control-small">XP</button><button disabled={Boolean(busy)} onClick={() => void runAction("profile.moderate", { profileId: row.id, isBanned: !row.is_banned, banReason: row.is_banned ? null : "Control Center", bannedUntil: null })} className={`control-small ${row.is_banned ? "control-good" : "control-danger"}`}>{row.is_banned ? <UserRoundCheck size={11}/> : <Ban size={11}/>} {row.is_banned ? "Разбан" : "Бан"}</button><button disabled={Boolean(busy)} onClick={() => void runAction("profile.moderate", { profileId: row.id, hiddenFromLeaderboard: !row.hidden_from_leaderboard })} className="control-small">{row.hidden_from_leaderboard ? <ToggleRight size={12}/> : <ToggleLeft size={12}/>}</button></div></Td></tr>)}</tbody></table>{!rows.length ? <Empty text="Игроки не найдены"/> : null}</div></SectionShell>;
}

function GiftsPanel({ payload, loading, busy, runAction, openModal }: { payload: DataPayload | null; loading: boolean; busy: string | null; runAction: (a: string, p?: Record<string, unknown>) => Promise<void>; openModal: (m: ModalState) => void }) {
  const rows = payload?.rows || [];
  return <SectionShell payload={payload} loading={loading}><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-[9px]"><thead className="border-b border-white/[.05] text-white/25"><tr><Th>Gift</Th><Th>Модель</Th><Th>Владелец</Th><Th>Цена</Th><Th>Источник</Th><Th>Chain</Th><Th>Статус</Th><Th className="text-right">Действия</Th></tr></thead><tbody className="divide-y divide-white/[.04]">{rows.map((row) => <tr key={row.virtual_gift_id} className="hover:bg-white/[.015]"><Td><div className="font-medium text-white/80">{row.base_name} #{row.gift_number}</div><div className="mt-0.5 text-[7px] text-white/20">{row.telegram_name || row.asset_id}</div></Td><Td>{row.model_name || "—"}<div className="text-[7px] text-white/20">{row.model_rarity || row.backdrop_name || ""}</div></Td><Td>{row.owner_name || "—"}</Td><Td>{row.status === "listed" ? `${money(row.listing_price)} TON` : <span className="text-white/25">не выставлен</span>}</Td><Td><Badge>{row.catalog_source || "unknown"}</Badge></Td><Td>{row.chain_verified ? <Badge good>verified</Badge> : <Badge danger>unverified</Badge>}</Td><Td><Badge good={row.status === "listed"}>{row.status}</Badge></Td><Td><div className="flex justify-end gap-1">{row.status === "listed" ? <button disabled={Boolean(busy)} onClick={() => void runAction("gift.list", { id: row.virtual_gift_id, price: null })} className="control-small">Снять</button> : <button disabled={Boolean(busy)} onClick={() => openModal({ kind: "giftPrice", row })} className="control-small">Выставить</button>}<a href={`/gifts/${row.virtual_gift_id}`} target="_blank" className="control-small">Открыть</a></div></Td></tr>)}</tbody></table>{!rows.length ? <Empty text="Gifts не найдены"/> : null}</div></SectionShell>;
}

function CoinsPanel({ payload, loading, busy, runAction }: { payload: DataPayload | null; loading: boolean; busy: string | null; runAction: (a: string, p?: Record<string, unknown>) => Promise<void> }) {
  const rows = payload?.rows || [];
  return <SectionShell payload={payload} loading={loading}><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[9px]"><thead className="border-b border-white/[.05] text-white/25"><tr><Th>Коин</Th><Th>Цена</Th><Th>Market cap</Th><Th>Reserves</Th><Th>Статус</Th><Th className="text-right">Управление</Th></tr></thead><tbody className="divide-y divide-white/[.04]">{rows.map((row) => <tr key={row.id}><Td><div className="font-medium text-white/80">{row.name} <span className="text-white/30">${row.symbol}</span></div><div className="mt-0.5 max-w-[260px] truncate text-[7px] text-white/20">{row.description}</div></Td><Td>{money(row.current_price)}</Td><Td>{money(row.market_cap)}</Td><Td>{compact(row.quote_reserve)} / {compact(row.token_reserve)}</Td><Td><div className="flex gap-1"><Badge good={row.status === "active"}>{row.status}</Badge>{row.hidden_from_market ? <Badge danger>hidden</Badge> : null}</div></Td><Td><div className="flex justify-end gap-1"><button disabled={Boolean(busy)} onClick={() => void runAction("coin.update", { id: row.id, hiddenFromMarket: !row.hidden_from_market })} className="control-small">{row.hidden_from_market ? "Показать" : "Скрыть"}</button><button disabled={Boolean(busy)} onClick={() => void runAction("coin.update", { id: row.id, status: row.status === "active" ? "dead" : "active" })} className="control-small">{row.status === "active" ? "Dead" : "Active"}</button></div></Td></tr>)}</tbody></table>{!rows.length ? <Empty text="Мемкоины не найдены"/> : null}</div></SectionShell>;
}

function MissionsPanel({ payload, loading, busy, runAction }: { payload: DataPayload | null; loading: boolean; busy: string | null; runAction: (a: string, p?: Record<string, unknown>) => Promise<void> }) {
  const rows = payload?.rows || [];
  return <SectionShell payload={payload} loading={loading}><div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((row) => <article key={row.id} className="rounded-[14px] border border-white/[.055] bg-black/15 p-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="text-[10px] font-medium text-white/80">{row.title}</div><p className="mt-1 line-clamp-2 text-[8px] leading-4 text-white/28">{row.description}</p></div><Badge good={row.active}>{row.active ? "active" : "off"}</Badge></div><div className="mt-3 grid grid-cols-3 gap-1 text-[8px]"><Mini label="Период" value={String(row.period)}/><Mini label="Reward" value={money(row.reward)}/><Mini label="Target" value={compact(row.target)}/></div><button disabled={Boolean(busy)} onClick={() => void runAction("mission.update", { id: row.id, active: !row.active })} className="control-small mt-3 w-full">{row.active ? "Выключить" : "Включить"}</button></article>)}{!rows.length ? <div className="md:col-span-2 xl:col-span-3"><Empty text="Задания не найдены"/></div> : null}</div></SectionShell>;
}

function StarsPanel({ payload, loading }: { payload: DataPayload | null; loading: boolean }) {
  const rows = payload?.rows || [];
  return <SectionShell payload={payload} loading={loading}><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[9px]"><thead className="border-b border-white/[.05] text-white/25"><tr><Th>Telegram</Th><Th>Stars</Th><Th>TON reward</Th><Th>SKU</Th><Th>Status</Th><Th>Создан</Th><Th>Paid/Refund</Th></tr></thead><tbody className="divide-y divide-white/[.04]">{rows.map((row) => <tr key={row.id}><Td className="font-mono">{row.payer_telegram_id || "—"}</Td><Td>{row.stars}</Td><Td>{money(row.ton_reward)}</Td><Td>{row.product_sku || "—"}</Td><Td><Badge good={row.status === "paid"} danger={row.status === "refunded"}>{row.status}</Badge></Td><Td>{date(row.created_at)}</Td><Td>{date(row.paid_at || row.refunded_at)}</Td></tr>)}</tbody></table>{!rows.length ? <Empty text="Stars-платежей нет"/> : null}</div></SectionShell>;
}

function CatalogPanel({ payload, loading, busy, runAction }: { payload: DataPayload | null; loading: boolean; busy: string | null; runAction: (a: string, p?: Record<string, unknown>) => Promise<void> }) {
  const rows = payload?.rows || [];
  return <div className="space-y-3"><div className="flex justify-end"><button disabled={Boolean(busy)} onClick={() => void runAction("catalog.sync")} className="control-primary"><RefreshCw size={12}/>Полная синхронизация</button></div><SectionShell payload={payload} loading={loading}><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-[9px]"><thead className="border-b border-white/[.05] text-white/25"><tr><Th>Коллекция</Th><Th>Address</Th><Th>Total hint</Th><Th>Offset</Th><Th>Verified</Th><Th>Last sync</Th><Th>Error</Th></tr></thead><tbody className="divide-y divide-white/[.04]">{rows.map((row) => <tr key={row.address}><Td><div className="font-medium text-white/80">{row.name || "Unnamed"}</div><div className="mt-0.5 max-w-[280px] truncate text-[7px] text-white/20">{row.description}</div></Td><Td className="max-w-[220px] truncate font-mono text-[7px]">{row.address}</Td><Td>{compact(row.total_hint)}</Td><Td>{compact(row.next_offset)}</Td><Td>{row.active ? <Badge good>active</Badge> : <Badge danger>off</Badge>} <span className="ml-1 text-white/25">{date(row.verified_at)}</span></Td><Td>{date(row.last_synced_at)}</Td><Td className="max-w-[260px] truncate text-[var(--negative)]">{row.last_error || "—"}</Td></tr>)}</tbody></table>{!rows.length ? <Empty text="Коллекции не найдены"/> : null}</div></SectionShell></div>;
}

function SystemPanel({ dashboard, busy, runAction, runOp, refresh }: { dashboard: Dashboard | null; busy: string | null; runAction: (a: string, p?: Record<string, unknown>) => Promise<void>; runOp: (a: string, p?: Record<string, unknown>) => Promise<void>; refresh: () => void }) {
  const [config, setConfig] = useState<RuntimeConfig | null>(dashboard?.runtimeConfig || null);
  useEffect(() => setConfig(dashboard?.runtimeConfig || null), [dashboard?.runtimeConfig]);
  if (!dashboard || !config) return <ScreenLoading text="Загрузка системного состояния"/>;
  async function save() { await runOp("runtime.update", { config }); refresh(); }
  return <div className="grid gap-4 xl:grid-cols-[1fr_.8fr] pb-8"><div className="space-y-4"><Panel title="Runtime Config" icon={<Settings2 size={14}/>}><div className="space-y-3"><label className="flex items-center justify-between rounded-[13px] border border-white/[.055] bg-black/15 p-3"><div><div className="text-[9px] font-medium">Maintenance Mode</div><div className="mt-1 text-[8px] text-white/25">Закрывает пользовательский интерфейс на техработы</div></div><input type="checkbox" checked={config.maintenanceMode} onChange={(event) => setConfig({ ...config, maintenanceMode: event.target.checked })}/></label><textarea value={config.maintenanceMessage} onChange={(event) => setConfig({ ...config, maintenanceMessage: event.target.value })} className="control-input min-h-[80px] resize-y" placeholder="Сообщение техработ"/><div className="grid gap-2 sm:grid-cols-2">{Object.entries(config.featureFlags).map(([key, value]) => <label key={key} className="flex items-center justify-between rounded-[12px] border border-white/[.05] bg-black/15 px-3 py-2.5 text-[9px]"><span>{key}</span><input type="checkbox" checked={value} onChange={(event) => setConfig({ ...config, featureFlags: { ...config.featureFlags, [key]: event.target.checked } })}/></label>)}</div><button disabled={Boolean(busy)} onClick={() => void save()} className="control-primary">Сохранить Runtime Config</button></div></Panel><Panel title="Операции" icon={<Wrench size={14}/>}><div className="grid gap-2 sm:grid-cols-2"><Quick title="Gift catalog sync" text="пересобрать TonAPI + Bot API" disabled={Boolean(busy)} onClick={() => void runAction("catalog.sync")}/><Quick title="NPC liquidity tick" text="точечно пополнить маркет" disabled={Boolean(busy)} onClick={() => void runAction("npc.tick", { targetListings: 18 })}/><Quick title="Player market handoff" text="проверить переход на player-only" disabled={Boolean(busy)} onClick={() => void runAction("npc.handoff")}/><Quick title="Release expired Stars" text="освободить зависшие reservations" disabled={Boolean(busy)} onClick={() => void runOp("stars.release_expired")}/></div></Panel></div><div className="space-y-4"><Panel title="Schema Health" icon={dashboard.schemaHealth.ready ? <CheckCircle2 size={14}/> : <ShieldAlert size={14}/>}><div className="grid grid-cols-2 gap-2"><Mini label="Current" value={`v${dashboard.schemaHealth.schemaVersion}`}/><Mini label="Required" value={`v${dashboard.schemaHealth.requiredSchemaVersion}`}/></div><div className="mt-3 space-y-1.5">{dashboard.schemaHealth.capabilities.map((cap) => <div key={cap.key} className="flex items-center gap-2 rounded-[10px] border border-white/[.045] px-2.5 py-2 text-[8px]"><span className={`h-1.5 w-1.5 rounded-full ${cap.ok ? "bg-[var(--positive)]" : "bg-[var(--negative)]"}`}/><span className="min-w-0 flex-1 truncate text-white/50">{cap.label}</span>{cap.required ? <span className="text-white/20">required</span> : null}</div>)}</div></Panel><Panel title="Ошибки / 24ч" icon={<ShieldAlert size={14}/>}><div className="space-y-2">{dashboard.latestErrors.map((row) => <div key={`${row.route}:${row.error_name}`} className="rounded-[11px] border border-white/[.05] bg-black/15 p-2.5"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[8px] text-white/55">{row.route}</span><span className="text-[8px] text-[var(--negative)]">×{row.count}</span></div><p className="mt-1 line-clamp-2 text-[8px] leading-4 text-white/25">{row.error_name}: {row.message}</p></div>)}</div></Panel></div></div>;
}

function AuditPanel({ payload, loading }: { payload: DataPayload | null; loading: boolean }) { const rows = payload?.rows || []; return <SectionShell payload={payload} loading={loading}><div className="divide-y divide-white/[.045]">{rows.map((row) => <div key={row.id} className="grid gap-2 px-3 py-3 md:grid-cols-[150px_180px_1fr_130px] md:items-center"><div><div className="text-[9px] font-medium text-white/70">{row.action}</div><div className="mt-0.5 text-[7px] text-white/20">{row.actor}</div></div><div className="truncate font-mono text-[8px] text-white/30">{row.target_type || "—"}:{row.target_id || "—"}</div><pre className="max-h-16 overflow-hidden whitespace-pre-wrap break-all text-[7px] leading-3 text-white/20">{JSON.stringify(row.payload)}</pre><div className="text-right text-[8px] text-white/25">{date(row.created_at)}</div></div>)}{!rows.length ? <Empty text="Audit log пуст"/> : null}</div></SectionShell>; }

function Th({ children, className = "" }: { children: ReactNode; className?: string }) { return <th className={`px-3 py-2.5 font-medium ${className}`}>{children}</th>; }
function Td({ children, className = "" }: { children: ReactNode; className?: string }) { return <td className={`px-3 py-2.5 text-white/48 ${className}`}>{children}</td>; }
function Badge({ children, good, danger }: { children: ReactNode; good?: boolean; danger?: boolean }) { return <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[7px] ${danger ? "border-[var(--negative)]/20 bg-[var(--negative)]/[.06] text-[var(--negative)]" : good ? "border-[var(--positive)]/20 bg-[var(--positive)]/[.05] text-[var(--positive)]" : "border-white/[.07] bg-white/[.03] text-white/35"}`}>{children}</span>; }

function Pagination({ payload, offset, setOffset }: { payload: DataPayload; offset: number; setOffset: (v: number) => void }) { const from = payload.total ? offset + 1 : 0; const to = Math.min(payload.total, offset + payload.limit); return <div className="mt-3 flex items-center justify-between text-[8px] text-white/25"><span>{from}–{to} из {payload.total}</span><div className="flex gap-1"><button disabled={offset <= 0} onClick={() => setOffset(Math.max(0, offset - payload.limit))} className="control-icon !h-8 !w-8"><ChevronLeft size={12}/></button><button disabled={offset + payload.limit >= payload.total} onClick={() => setOffset(offset + payload.limit)} className="control-icon !h-8 !w-8"><ChevronRight size={12}/></button></div></div>; }

function ActionModal({ modal, close, runAction }: { modal: Exclude<ModalState, null>; close: () => void; runAction: (a: string, p?: Record<string, unknown>) => Promise<void> }) {
  const [value, setValue] = useState(modal.kind === "balance" ? String(modal.row.balance || 0) : modal.kind === "xp" ? String(modal.row.xp || 0) : String(modal.row.listing_price || modal.row.estimated_value || ""));
  const [reason, setReason] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); const numeric = Number(value); if (!Number.isFinite(numeric) || numeric < 0) return; if (modal.kind === "balance") await runAction("balance.set", { profileId: modal.row.id, balance: numeric, reason: reason || "Control Center" }); if (modal.kind === "xp") await runAction("profile.set_xp", { profileId: modal.row.id, xp: numeric }); if (modal.kind === "giftPrice") await runAction("gift.list", { id: modal.row.virtual_gift_id, price: numeric }); close(); }
  const title = modal.kind === "balance" ? "Установить баланс" : modal.kind === "xp" ? "Установить XP" : "Выставить Gift";
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}><form onSubmit={submit} className="w-full max-w-[410px] rounded-[20px] border border-white/[.08] bg-[#0b0e12] p-5 shadow-2xl"><div className="flex items-center justify-between"><h3 className="text-[13px] font-semibold">{title}</h3><button type="button" onClick={close} className="text-[9px] text-white/30">Закрыть</button></div><p className="mt-1 truncate text-[9px] text-white/25">{modal.row.username ? `@${modal.row.username}` : modal.row.base_name || modal.row.id}</p><label className="mt-4 block text-[8px] text-white/30">Значение<input autoFocus type="number" min="0" step={modal.kind === "xp" ? "1" : "0.01"} value={value} onChange={(event) => setValue(event.target.value)} className="control-input mt-1.5 !min-h-10 !text-[12px]"/></label>{modal.kind === "balance" ? <label className="mt-3 block text-[8px] text-white/30">Причина<input value={reason} onChange={(event) => setReason(event.target.value)} className="control-input mt-1.5" placeholder="Корректировка через Control Center"/></label> : null}<div className="mt-4 flex justify-end gap-2"><button type="button" onClick={close} className="control-small">Отмена</button><button className="control-primary">Применить</button></div></form></div>;
}
