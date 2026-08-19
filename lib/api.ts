const exactErrors: Record<string, string> = {
  Unauthorized: "Сессия Telegram истекла. Откройте MXM заново.",
  "Insufficient available balance": "Недостаточно доступного баланса.",
  "Insufficient available balance for this offer": "Недостаточно доступного баланса для этого оффера.",
  "Invalid offer amount": "Некорректная сумма оффера.",
  "Gift is not listed": "Подарок уже снят с продажи.",
  "Gift listing expired": "Срок этого листинга истёк.",
  "Offer expired": "Срок оффера истёк.",
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
  if (/\$?250|250 MXM cash/i.test(message)) return "Недостаточно виртуальных TON для запуска мемкоина.";
  if (message.startsWith("Buyer no longer has")) return "У покупателя больше недостаточно доступного баланса.";
  if (message.includes("already burned") || message.includes("is burned")) return "Этот подарок помечен Telegram как сожжённый и не торгуется.";
  if (message.includes("Telegram") && message.toLowerCase().includes("gift") && message.toLowerCase().includes("missing")) return "Telegram не вернул обязательные данные подарка.";
  return message;
}

type ApiRequestInit = RequestInit & { timeoutMs?: number; cacheMs?: number; dedupe?: boolean };

type ApiPerfState = {
  total: number;
  failures: number;
  inFlight: number;
  lastLatencyMs: number;
  avgLatencyMs: number;
  slowestLatencyMs: number;
};

const apiPerf: ApiPerfState = {
  total: 0,
  failures: 0,
  inFlight: 0,
  lastLatencyMs: 0,
  avgLatencyMs: 0,
  slowestLatencyMs: 0,
};

type MemoryEntry = { expiresAt: number; value: unknown };
const GET_CACHE_LIMIT = 48;
const getMemoryCache = new Map<string, MemoryEntry>();
const getInFlight = new Map<string, Promise<unknown>>();

function rememberGet(key: string, value: unknown, cacheMs: number) {
  if (cacheMs <= 0) return;
  getMemoryCache.delete(key);
  getMemoryCache.set(key, { expiresAt: Date.now() + cacheMs, value });
  while (getMemoryCache.size > GET_CACHE_LIMIT) {
    const oldest = getMemoryCache.keys().next().value as string | undefined;
    if (!oldest) break;
    getMemoryCache.delete(oldest);
  }
}

function readRememberedGet<T>(key: string): T | null {
  const entry = getMemoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    getMemoryCache.delete(key);
    return null;
  }
  getMemoryCache.delete(key);
  getMemoryCache.set(key, entry);
  return entry.value as T;
}

export function clearApiMemoryCache(prefix?: string) {
  if (!prefix) {
    getMemoryCache.clear();
    return;
  }
  for (const key of getMemoryCache.keys()) if (key.includes(prefix)) getMemoryCache.delete(key);
}

function markCompleted(startedAt: number, failed: boolean) {
  const latency = Math.max(0, Date.now() - startedAt);
  apiPerf.inFlight = Math.max(0, apiPerf.inFlight - 1);
  apiPerf.total += 1;
  if (failed) apiPerf.failures += 1;
  apiPerf.lastLatencyMs = latency;
  apiPerf.slowestLatencyMs = Math.max(apiPerf.slowestLatencyMs, latency);
  apiPerf.avgLatencyMs = apiPerf.total === 1
    ? latency
    : Math.round((apiPerf.avgLatencyMs * 0.82) + (latency * 0.18));
}

export function getApiPerfSnapshot() {
  return { ...apiPerf };
}

export async function apiFetch<T>(input: string, init?: ApiRequestInit): Promise<T> {
  const { timeoutMs = 55_000, cacheMs, dedupe = true, signal: callerSignal, ...requestInit } = init || {};
  const method = String(requestInit.method || "GET").toUpperCase();
  const isGet = method === "GET" && requestInit.body == null;
  const effectiveCacheMs = cacheMs ?? (isGet ? 2_500 : 0);
  const requestKey = `${method}:${input}`;

  if (isGet) {
    const remembered = readRememberedGet<T>(requestKey);
    if (remembered !== null) return remembered;
    const pending = dedupe ? getInFlight.get(requestKey) : null;
    if (pending) return pending as Promise<T>;
  }

  const task = (async () => {
    const headers = new Headers(requestInit.headers);
    const isForm = typeof FormData !== "undefined" && requestInit.body instanceof FormData;
    if (requestInit.body && !isForm && !headers.has("content-type")) headers.set("content-type", "application/json");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
    const abortFromCaller = () => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

    const startedAt = Date.now();
    apiPerf.inFlight += 1;
    let failed = false;

    try {
      const response = await fetch(input, { ...requestInit, headers, signal: controller.signal, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof payload?.error === "string" ? payload.error : `Запрос не выполнен (${response.status})`;
        throw new Error(localizeApiError(message));
      }
      if (isGet) rememberGet(requestKey, payload, effectiveCacheMs);
      else clearApiMemoryCache();
      return payload as T;
    } catch (error) {
      failed = true;
      if (controller.signal.aborted && !callerSignal?.aborted) throw new Error("Сервер отвечает слишком долго. Повторите запрос.");
      throw error;
    } finally {
      markCompleted(startedAt, failed);
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  })();

  if (isGet && dedupe) getInFlight.set(requestKey, task);
  try {
    return await task;
  } finally {
    if (isGet && getInFlight.get(requestKey) === task) getInFlight.delete(requestKey);
  }
}

export function prefetchApi<T>(input: string, init?: Omit<ApiRequestInit, "method" | "body">) {
  return apiFetch<T>(input, { ...init, method: "GET", cacheMs: init?.cacheMs ?? 10_000 }).catch(() => undefined);
}
