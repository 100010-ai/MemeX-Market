import { finiteNumber, nullableNumber, record, safeIsoDate, text } from "@/lib/safe-data";

export type CoinHeatTier = "quiet" | "moving" | "trending" | "hot" | "viral";
export type CoinLevelKey = "launch" | "established" | "trending" | "viral" | "legend";
export type CoinHealthGrade = "strong" | "balanced" | "watch" | "fragile";

export type CreatorReputation = {
  score: number;
  grade: string;
  coinCount: number;
  activeCoins: number;
  externalHolders: number;
  uniqueTraders: number;
  externalVolume: number;
  marketAgeDays: number;
  verified: boolean;
  verificationTier: string | null;
  antiWash: boolean;
};

export type CoinProgressTarget = { current: number; target: number };

export type CoinPulse = {
  heat: {
    score: number;
    tier: CoinHeatTier;
    uniqueTraders24h: number;
    topTraderShareBps: number;
    buyShareBps: number;
    lastTradeAt: string | null;
  };
  level: {
    number: number;
    key: CoinLevelKey;
    progressPct: number;
    targets: null | {
      holders: CoinProgressTarget;
      traders: CoinProgressTarget;
      volume: CoinProgressTarget;
    };
  };
  og: {
    count: number;
    limit: number;
    remaining: number;
    userOrdinal: number | null;
  };
  distribution: {
    topHolderShareBps: number;
    top3ShareBps: number;
    creatorShareBps: number;
    creatorLockedShareBps: number;
  };
  health: {
    score: number;
    grade: CoinHealthGrade;
    flags: string[];
  };
  verification: {
    coinVerified: boolean;
    coinTier: string | null;
    creatorVerified: boolean;
    creatorTier: string | null;
  };
  creatorReputation: CreatorReputation;
  ageHours: number;
};

const heatTiers = new Set<CoinHeatTier>(["quiet", "moving", "trending", "hot", "viral"]);
const levelKeys = new Set<CoinLevelKey>(["launch", "established", "trending", "viral", "legend"]);
const healthGrades = new Set<CoinHealthGrade>(["strong", "balanced", "watch", "fragile"]);

function int(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Math.min(max, Math.max(min, Math.floor(finiteNumber(value))));
}

function bounded(value: unknown, min: number, max: number) {
  return Math.min(max, Math.max(min, finiteNumber(value)));
}

function optionalIso(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = safeIsoDate(value, "");
  return parsed || null;
}

function progressTarget(value: unknown): CoinProgressTarget {
  const row = record(value) ?? {};
  return {
    current: Math.max(0, finiteNumber(row.current)),
    target: Math.max(0, finiteNumber(row.target)),
  };
}

export function mapCreatorReputation(value: unknown): CreatorReputation {
  const row = record(value) ?? {};
  return {
    score: int(row.score, 0, 100),
    grade: text(row.grade, "Starter", 32),
    coinCount: int(row.coinCount),
    activeCoins: int(row.activeCoins),
    externalHolders: int(row.externalHolders),
    uniqueTraders: int(row.uniqueTraders),
    externalVolume: Math.max(0, finiteNumber(row.externalVolume)),
    marketAgeDays: Math.max(0, finiteNumber(row.marketAgeDays)),
    verified: row.verified === true,
    verificationTier: row.verificationTier == null ? null : text(row.verificationTier, "", 40) || null,
    antiWash: row.antiWash === true,
  };
}

export function mapCoinPulse(value: unknown): CoinPulse {
  const root = record(value) ?? {};
  const heat = record(root.heat) ?? {};
  const level = record(root.level) ?? {};
  const og = record(root.og) ?? {};
  const distribution = record(root.distribution) ?? {};
  const health = record(root.health) ?? {};
  const verification = record(root.verification) ?? {};
  const targets = record(level.targets);
  const rawHeatTier = text(heat.tier, "quiet", 20) as CoinHeatTier;
  const rawLevelKey = text(level.key, "launch", 24) as CoinLevelKey;
  const rawHealthGrade = text(health.grade, "fragile", 24) as CoinHealthGrade;
  const flags = Array.isArray(health.flags)
    ? health.flags.map((item) => text(item, "", 64)).filter(Boolean).slice(0, 20)
    : [];
  const userOrdinal = nullableNumber(og.userOrdinal);

  return {
    heat: {
      score: int(heat.score, 0, 100),
      tier: heatTiers.has(rawHeatTier) ? rawHeatTier : "quiet",
      uniqueTraders24h: int(heat.uniqueTraders24h),
      topTraderShareBps: int(heat.topTraderShareBps, 0, 10_000),
      buyShareBps: int(heat.buyShareBps, 0, 10_000),
      lastTradeAt: optionalIso(heat.lastTradeAt),
    },
    level: {
      number: int(level.number, 1, 5),
      key: levelKeys.has(rawLevelKey) ? rawLevelKey : "launch",
      progressPct: int(level.progressPct, 0, 100),
      targets: targets ? {
        holders: progressTarget(targets.holders),
        traders: progressTarget(targets.traders),
        volume: progressTarget(targets.volume),
      } : null,
    },
    og: {
      count: int(og.count),
      limit: Math.max(1, int(og.limit, 1, 1000)),
      remaining: int(og.remaining),
      userOrdinal: userOrdinal == null ? null : int(userOrdinal, 1, 1000),
    },
    distribution: {
      topHolderShareBps: int(distribution.topHolderShareBps, 0, 10_000),
      top3ShareBps: int(distribution.top3ShareBps, 0, 10_000),
      creatorShareBps: int(distribution.creatorShareBps, 0, 10_000),
      creatorLockedShareBps: int(distribution.creatorLockedShareBps, 0, 10_000),
    },
    health: {
      score: int(health.score, 0, 100),
      grade: healthGrades.has(rawHealthGrade) ? rawHealthGrade : "fragile",
      flags,
    },
    verification: {
      coinVerified: verification.coinVerified === true,
      coinTier: verification.coinTier == null ? null : text(verification.coinTier, "", 40) || null,
      creatorVerified: verification.creatorVerified === true,
      creatorTier: verification.creatorTier == null ? null : text(verification.creatorTier, "", 40) || null,
    },
    creatorReputation: mapCreatorReputation(root.creatorReputation),
    ageHours: bounded(root.ageHours, 0, 24 * 365 * 100),
  };
}
