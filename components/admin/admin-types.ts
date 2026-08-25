export type AdminRole = "owner" | "operator" | "moderator" | "analyst";

export type AdminContext = {
  profileId: string;
  role: AdminRole;
  roleLabel: string;
  permissions: string[];
  source: "environment" | "database" | "key";
};

export type AdminMember = {
  profileId: string;
  telegramId: number;
  username: string | null;
  firstName: string;
  role: AdminRole;
  permissions: string[];
  active: boolean;
  source: "database";
  createdAt: string;
  updatedAt: string;
};

export type AnalyticsDay = {
  date: string;
  newPlayers: number;
  activePlayers: number;
  returningPlayers: number;
  sessions: number;
  sessionMinutes: number;
  trades: number;
  turnover: number;
  stars: number;
};

export type AdminAnalytics = {
  periodDays: 7 | 30 | 90;
  periodStart: string;
  periodEnd: string;
  trackingStartedAt: string | null;
  summary: {
    onlineNow: number;
    activeToday: number;
    activePeriod: number;
    activePrevious: number;
    newPeriod: number;
    newPrevious: number;
    returningPeriod: number;
    sessions: number;
    avgSessionMinutes: number;
    traders: number;
    payers: number;
    referredNew: number;
    trades: number;
    turnover: number;
    stars: number;
  };
  daily: AnalyticsDay[];
  funnel: Array<{ key: string; label: string; value: number }>;
  retention: Array<{ label: string; days: number; eligible: number; retained: number; rate: number }>;
  topRoutes: Array<{ route: string; visitors: number; sessions: number }>;
};

export type AdminAnalyticsResponse = { analytics: AdminAnalytics; generatedAt: string };
