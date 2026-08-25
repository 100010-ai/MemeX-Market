"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Activity, ArrowUpRight, CircleDollarSign, Coins, Gift, Radio, RefreshCw, ShieldCheck, Sparkles, UserPlus, Users } from "lucide-react";
import { AdminTrendChart, type AdminChartSeries } from "@/components/admin/admin-trend-chart";
import type { AdminAnalytics } from "@/components/admin/admin-types";

type DashboardMetrics = {
  players: number;
  banned: number;
  activeCoins: number;
  listedGifts: number;
  starsRevenueToday: number;
  refundReconciliationRequired: number;
  tonapiAssets: number;
  tonapiVerified: number;
};

type DashboardStatus = {
  tonapiError?: string | null;
  npcError?: string | null;
  catalogErrors: number;
};

const periods = [7, 30, 90] as const;

function number(value: number, digits = 1) {
  return new Intl.NumberFormat("ru-RU", { notation: Math.abs(value) >= 10_000 ? "compact" : "standard", maximumFractionDigits: digits }).format(Number(value) || 0);
}

function percentDelta(current: number, previous: number) {
  if (!previous) return current > 0 ? "Новый рост" : "Без изменений";
  const delta = ((current - previous) / previous) * 100;
  return `${delta >= 0 ? "+" : ""}${number(delta)}% к прошлому периоду`;
}

function AdminHeroKpi({ icon: Icon, label, value, note, tone = "neutral", live = false }: { icon: typeof Users; label: string; value: string; note: string; tone?: "neutral" | "good" | "accent"; live?: boolean }) {
  return <article className={`admin-hero-kpi is-${tone}`}><div className="admin-hero-kpi-head"><span className="admin-hero-kpi-icon"><Icon size={15}/></span><span>{label}</span>{live ? <i aria-label="Данные в реальном времени"/> : null}</div><strong>{value}</strong><p>{note}</p></article>;
}

function ChartLegend({ series }: { series: AdminChartSeries[] }) {
  return <div className="admin-chart-legend">{series.map((item) => <span key={item.key}><i style={{ background: item.color }}/>{item.label}</span>)}</div>;
}

export function AdminDashboard({ analytics, metrics, status, period, loading, onPeriodChange, onRefresh }: { analytics: AdminAnalytics; metrics: DashboardMetrics; status: DashboardStatus; period: 7 | 30 | 90; loading: boolean; onPeriodChange: (period: 7 | 30 | 90) => void; onRefresh: () => void }) {
  const growthSeries = useMemo<AdminChartSeries[]>(() => [
    { key: "active", label: "Активные", color: "#a6b5ff", kind: "area", values: analytics.daily.map((row) => ({ date: row.date, value: row.activePlayers })) },
    { key: "returning", label: "Вернувшиеся", color: "#63d6a4", kind: "line", values: analytics.daily.map((row) => ({ date: row.date, value: row.returningPlayers })) },
    { key: "new", label: "Новые", color: "#f1b96b", kind: "histogram", values: analytics.daily.map((row) => ({ date: row.date, value: row.newPlayers })) },
  ], [analytics.daily]);
  const engagementSeries = useMemo<AdminChartSeries[]>(() => [
    { key: "sessions", label: "Сессии", color: "#a6b5ff", kind: "area", values: analytics.daily.map((row) => ({ date: row.date, value: row.sessions })) },
    { key: "trades", label: "Сделки", color: "#f1b96b", kind: "histogram", values: analytics.daily.map((row) => ({ date: row.date, value: row.trades })) },
    { key: "stars", label: "Stars", color: "#63d6a4", kind: "line", values: analytics.daily.map((row) => ({ date: row.date, value: row.stars })) },
  ], [analytics.daily]);
  const summary = analytics.summary;
  const funnelBase = Math.max(1, analytics.funnel[0]?.value || 0);
  const issues = [
    status.tonapiError ? `TonAPI: ${status.tonapiError}` : null,
    status.npcError ? `Системный пул: ${status.npcError}` : null,
    status.catalogErrors ? `${status.catalogErrors} источников каталога требуют внимания` : null,
    metrics.refundReconciliationRequired ? `${metrics.refundReconciliationRequired} возвратов Stars ждут сверки` : null,
  ].filter(Boolean) as string[];
  const coverage = analytics.trackingStartedAt ? new Date(analytics.trackingStartedAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null;

  return <div className="admin-dashboard-v067">
    <section className="admin-dashboard-hero">
      <div className="admin-dashboard-intro"><div><span className="admin-dashboard-kicker"><Sparkles size={12}/> LIVE OPERATIONS</span><h2>Пульс MemeX Market</h2><p>Рост, удержание и экономика в одном рабочем пространстве.</p></div><div className="admin-period-control" aria-label="Период аналитики">{periods.map((value) => <button key={value} type="button" onClick={() => onPeriodChange(value)} className={period === value ? "is-active" : ""}>{value}д</button>)}<button type="button" onClick={onRefresh} aria-label="Обновить аналитику"><RefreshCw size={12} className={loading ? "animate-spin" : ""}/></button></div></div>
      <div className="admin-hero-kpis">
        <AdminHeroKpi icon={Radio} label="Онлайн сейчас" value={number(summary.onlineNow, 0)} note="Активность за последние 5 минут" tone="good" live/>
        <AdminHeroKpi icon={Activity} label="Активны сегодня" value={number(summary.activeToday, 0)} note={`${number(summary.activePeriod, 0)} за ${period} дней`} tone="accent"/>
        <AdminHeroKpi icon={UserPlus} label="Новые игроки" value={number(summary.newPeriod, 0)} note={percentDelta(summary.newPeriod, summary.newPrevious)}/>
        <AdminHeroKpi icon={Users} label="Вернулись" value={number(summary.returningPeriod, 0)} note={percentDelta(summary.activePeriod, summary.activePrevious)}/>
        <AdminHeroKpi icon={CircleDollarSign} label="Оборот" value={`${number(summary.turnover)} TON`} note={`${number(summary.trades, 0)} сделок · ${number(summary.payers, 0)} плательщиков`}/>
      </div>
      <div className="admin-coverage-note"><ShieldCheck size={12}/><span>{coverage ? `Live-присутствие учитывается с ${coverage}. Исторические активные пользователи восстановлены по сделкам и событиям экономики.` : "Live-присутствие начнёт заполняться после первого входа игрока; исторические значения строятся по подтверждённым действиям."}</span></div>
    </section>

    <div className="admin-dashboard-chart-grid">
      <section className="admin-chart-panel"><header><div><span>GROWTH</span><h3>Игроки во времени</h3><p>Новые, активные и вернувшиеся пользователи</p></div><ChartLegend series={growthSeries}/></header><AdminTrendChart series={growthSeries}/></section>
      <section className="admin-chart-panel"><header><div><span>ENGAGEMENT</span><h3>Сессии и действия</h3><p>Присутствие, торговля и покупки Stars</p></div><ChartLegend series={engagementSeries}/></header><AdminTrendChart series={engagementSeries}/></section>
    </div>

    <div className="admin-insight-grid">
      <section className="admin-insight-panel"><header><div><span>CONVERSION</span><h3>Воронка новых игроков</h3></div><small>{period} дней</small></header><div className="admin-funnel">{analytics.funnel.map((step, index) => { const previous = analytics.funnel[index - 1]?.value || step.value; const conversion = index === 0 ? 100 : previous ? Math.round(step.value / previous * 100) : 0; return <div key={step.key} className="admin-funnel-row"><div><span>{step.label}</span><b>{number(step.value, 0)}</b><small>{index === 0 ? "база" : `${conversion}% шага`}</small></div><div className="admin-funnel-track"><i style={{ width: `${Math.max(step.value ? 5 : 0, step.value / funnelBase * 100)}%` }}/></div></div>; })}</div></section>
      <section className="admin-insight-panel"><header><div><span>RETENTION</span><h3>Возврат игроков</h3></div><small>когорты 90д</small></header><div className="admin-retention-grid">{analytics.retention.map((point) => <article key={point.label}><div className="admin-retention-ring"><strong>{number(point.rate)}%</strong></div><div><b>{point.label}</b><span>{point.retained} из {point.eligible}</span></div></article>)}</div></section>
      <section className="admin-insight-panel"><header><div><span>NAVIGATION</span><h3>Популярные разделы</h3></div><small>live</small></header>{analytics.topRoutes.length ? <div className="admin-route-list">{analytics.topRoutes.map((row, index) => <div key={row.route}><span>{index + 1}</span><code>{row.route}</code><b>{number(row.visitors, 0)}</b><small>{row.sessions} сесс.</small></div>)}</div> : <div className="admin-panel-empty">Маршруты появятся после первых live-сессий.</div>}</section>
    </div>

    <div className="admin-operations-grid">
      <section className="admin-insight-panel"><header><div><span>BUSINESS</span><h3>Коммерческий срез</h3></div><Link href="/admin/economy-risk">Risk Center <ArrowUpRight size={11}/></Link></header><div className="admin-business-grid"><div><Coins size={14}/><span>Активные мемкоины</span><b>{number(metrics.activeCoins, 0)}</b></div><div><Gift size={14}/><span>Лоты подарков</span><b>{number(metrics.listedGifts, 0)}</b></div><div><CircleDollarSign size={14}/><span>Stars сегодня</span><b>{number(metrics.starsRevenueToday, 0)}</b></div><div><Users size={14}/><span>Всего игроков</span><b>{number(metrics.players, 0)}</b></div></div></section>
      <section className={`admin-insight-panel admin-issues-panel ${issues.length ? "has-issues" : "is-clear"}`}><header><div><span>OPERATIONS</span><h3>{issues.length ? "Требует внимания" : "Системы в норме"}</h3></div><Link href="/admin/health">Health <ArrowUpRight size={11}/></Link></header>{issues.length ? <div className="admin-issue-list">{issues.map((issue) => <p key={issue}><i/>{issue}</p>)}</div> : <div className="admin-clear-state"><ShieldCheck size={18}/><div><b>Критичных сигналов нет</b><span>Каталог, платежи и системный пул без известных ошибок.</span></div></div>}</section>
    </div>
  </div>;
}
