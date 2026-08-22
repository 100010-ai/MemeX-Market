const rankLabels: Record<string, string> = {
  bronze: "Бронза",
  silver: "Серебро",
  gold: "Золото",
  platinum: "Платина",
  diamond: "Алмаз",
};

const rarityLabels: Record<string, string> = {
  common: "Обычная",
  uncommon: "Необычная",
  rare: "Редкая",
  epic: "Эпическая",
  legendary: "Легендарная",
};

const itemTypeLabels: Record<string, string> = {
  frame: "Рамка",
  badge: "Значок",
  collectible: "Коллекционный предмет",
  title: "Титул",
};

export function rankLabel(value: string | null | undefined) {
  const normalized = String(value || "bronze").trim().toLowerCase();
  return rankLabels[normalized] || value || "Бронза";
}

export function rarityLabel(value: string | null | undefined) {
  const normalized = String(value || "common").trim().toLowerCase();
  return rarityLabels[normalized] || value || "Обычная";
}

export function itemTypeLabel(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  return itemTypeLabels[normalized] || value || "Предмет";
}
