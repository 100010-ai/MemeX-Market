import type { CoinHealthGrade, CoinHeatTier, CoinLifecycleKey, CoinRiskGrade } from "@/lib/coin-pulse";

export const memecoinLifecycleLabels: Record<CoinLifecycleKey, string> = {
  prelaunch: "Подготовка",
  launch: "Запуск",
  growth: "Рост",
  graduated: "Основной рынок",
  elite: "Элита",
  legendary: "Легенда",
};

export const memecoinActivityLabels: Record<CoinHeatTier, string> = {
  quiet: "Тихо",
  moving: "Есть движение",
  trending: "В тренде",
  hot: "Горячо",
  viral: "Вирусно",
};

export const memecoinHealthLabels: Record<CoinHealthGrade, string> = {
  strong: "Сильное",
  balanced: "Стабильное",
  watch: "Нужно следить",
  fragile: "Хрупкое",
};

export const memecoinRiskLabels: Record<CoinRiskGrade, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
  critical: "Критический",
};

export const creatorReputationLabels: Record<string, string> = {
  Starter: "Начинающий",
  Builder: "Развивается",
  Proven: "Проверенный",
  Trusted: "Надёжный",
  Elite: "Элитный",
};

export const memecoinFlagLabels: Record<string, string> = {
  low_holder_count: "Мало владельцев",
  holder_concentration: "Высокая концентрация у крупных владельцев",
  single_trader_activity: "Большая часть объёма у одного трейдера",
  creator_concentration: "У автора слишком большая свободная доля",
  thin_liquidity: "Низкая ликвидность",
  low_participation: "Мало независимых участников",
  new_market: "Очень молодой рынок",
  creator_selling: "Автор активно продаёт",
  deep_drawdown: "Глубокая просадка от максимума",
};

export function memecoinFlagLabel(value: string) {
  return memecoinFlagLabels[value] || value.replaceAll("_", " ");
}

export function creatorReputationLabel(value: string) {
  return creatorReputationLabels[value] || value;
}
