const exactErrors: Record<string, string> = {
  Unauthorized: "Сессия Telegram истекла. Откройте MXM заново.",
  "Insufficient available balance": "Недостаточно доступного баланса.",
  "Insufficient available balance for this offer": "Недостаточно доступного баланса для этого оффера.",
  "Invalid offer amount": "Некорректная сумма оффера.",
  "Gift is not listed": "Подарок уже снят с продажи.",
  "You already own this Gift": "Этот подарок уже принадлежит вам.",
  "Gift not found": "Подарок не найден.",
  "Coin not found": "Коин не найден.",
  "Coin is not tradeable": "Торговля этим коином недоступна.",
  "Trade is too small": "Слишком маленькая сделка.",
  "Ticker already exists": "Такой тикер уже занят.",
  "Invalid coin name": "Некорректное название коина.",
  "Invalid ticker": "Некорректный тикер.",
  "Name must be 2–32 characters": "Название должно содержать 2–32 символа.",
  "Ticker must be 2–8 letters/numbers": "Тикер должен содержать 2–8 латинских букв или цифр.",
  "Description is too long": "Описание слишком длинное.",
  "Gift sync is limited to once every 20 seconds": "Синхронизацию подарков можно запускать не чаще одного раза в 20 секунд.",
};

function localizeApiError(message: string): string {
  const exact = exactErrors[message];
  if (exact) return exact;
  if (message.startsWith("You need $") || message.includes("virtual TON available")) return "Недостаточно доступного виртуального TON для этой операции.";
  if (/Minimum (buy|sell).*\$?0\.01/i.test(message)) return "Минимальная сумма сделки — 0.01 виртуального TON.";
  if (/\$50|50 MXM cash/i.test(message)) return "Для запуска мемкоина нужно 50 виртуальных TON.";
  if (message.startsWith("Buyer no longer has")) return "У покупателя больше недостаточно доступного баланса.";
  if (message.includes("already burned") || message.includes("is burned")) return "Этот подарок помечен Telegram как сожжённый и не торгуется.";
  if (message.includes("Telegram") && message.toLowerCase().includes("gift") && message.toLowerCase().includes("missing")) return "Telegram не вернул обязательные данные подарка.";
  return message;
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (init?.body && !isForm && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(input, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `Запрос не выполнен (${response.status})`;
    throw new Error(localizeApiError(message));
  }
  return payload as T;
}
