export function traderLevelTitle(level: number) {
  const safeLevel = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  if (safeLevel >= 50) return "Legend";
  if (safeLevel >= 25) return "Whale";
  if (safeLevel >= 10) return "Trader";
  return "Beginner";
}

export function traderLevelProgressCopy(level: number, xpForNext: number) {
  const safeXp = Math.max(0, Math.floor(Number.isFinite(xpForNext) ? xpForNext : 0));
  const nextTitle = traderLevelTitle(level + 1);
  return safeXp ? `До ${nextTitle} осталось ${safeXp.toLocaleString("ru-RU")} XP` : "Максимальный уровень";
}
