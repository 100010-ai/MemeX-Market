const exactErrors: Record<string, string> = {
  Unauthorized: "Сессия Telegram истекла. Откройте MXM заново.",
  "Insufficient available balance": "Недостаточно доступного баланса.",
  "Insufficient available balance for this offer": "Недостаточно доступного баланса для этого предложения.",
  "Некорректная сумма предложения": "Некорректная сумма предложения.",
  "Gift is not listed": "Подарок уже снят с продажи.",
  "Gift listing expired": "Срок продажи этого подарка истёк.",
  "Offer expired": "Срок предложения истёк.",
  "Этот подарок уже принадлежит вам": "Этот подарок уже принадлежит вам.",
  "Gift not found": "Подарок не найден.",
  "Мемкоин не найден": "Мемкоин не найден.",
  "Этот мемкоин недоступен для торговли": "Торговля этим мемкоином недоступна.",
  "Сумма сделки слишком мала": "Слишком маленькая сделка.",
  "Ticker already exists": "Такой тикер уже занят.",
  "Invalid coin name": "Некорректное название мемкоина.",
  "Invalid ticker": "Некорректный тикер.",
  "Name must be 2–32 characters": "Название должно содержать 2–32 символа.",
  "Ticker must be 2–8 letters/numbers": "Тикер должен содержать 2–8 латинских букв или цифр.",
  "Description is too long": "Описание слишком длинное.",
  "Gift sync is limited to once every 20 seconds": "Синхронизацию подарков можно запускать не чаще одного раза в 20 секунд.",
  "Gift asset not found": "Данные подарка не найдены.",
  "Gift asset is missing": "Данные подарка отсутствуют.",
  "You do not own this Gift": "Этот подарок вам не принадлежит.",
  "You do not own this gift": "Этот подарок вам не принадлежит.",
  "Burned Gift cannot be listed": "Сожжённый подарок нельзя выставить на продажу.",
  "One or more Gifts are no longer listed": "Один или несколько подарков уже сняты с продажи.",
  "One or more Gifts do not exist": "Один или несколько подарков больше не существуют.",
  "Cart contains a Gift you already own": "В корзине есть подарок, который уже принадлежит вам.",
  "Cart contains a burned Gift": "В корзине есть сожжённый подарок.",
  "Cart contains duplicate Gifts": "В корзине есть повторяющиеся подарки.",
  "Buyer not found": "Покупатель не найден.",
  "Profile not found": "Профиль не найден.",
  "Offer is no longer pending": "Предложение уже недоступно.",
  "Pending offer not found": "Активное предложение не найдено.",
  "Buyer no longer has enough balance": "У покупателя больше недостаточно доступного баланса.",
  "Mission not available": "Задание недоступно.",
  "Mission not found": "Задание не найдено.",
  "Reward already claimed": "Награда уже получена.",
  "Mission is not complete": "Задание ещё не выполнено.",
  "Insufficient balance": "Недостаточно доступного баланса.",
  "Trade too small": "Сумма сделки слишком мала.",
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

type ApiRequestInit = RequestInit & { timeoutMs?: number; cacheMs?: number; dedupe?: boolean; retries?: number };

export class ApiRequestError extends Error {
  status: number;
  code: string | null;
  requestId: string | null;

  constructor(message: string, status: number, code: string | null, requestId: string | null) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

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
let apiCacheNamespace = "anon";
let apiCacheGeneration = 0;

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
  // Bump a generation token on every invalidation so a GET that started before
  // a successful mutation can never repopulate the cache with stale data after
  // that mutation completed. This matters on fast buy/list/claim flows where a
  // previous in-flight request may otherwise win the race.
  apiCacheGeneration += 1;
  if (!prefix) {
    getMemoryCache.clear();
    getInFlight.clear();
    return;
  }
  for (const key of getMemoryCache.keys()) if (key.includes(prefix)) getMemoryCache.delete(key);
  for (const key of getInFlight.keys()) if (key.includes(prefix)) getInFlight.delete(key);
}

/**
 * Keep user-scoped GET responses isolated when the same Telegram WebView
 * origin is opened from another Telegram account. Telegram Desktop reuses
 * origin cookies/storage between accounts, so URL-only cache keys can leak a
 * previous player's portfolio/tasks for a few seconds after account switch.
 */
export function setApiCacheNamespace(namespace: string | number | null | undefined) {
  const next = String(namespace ?? "anon").trim() || "anon";
  if (next === apiCacheNamespace) return;
  apiCacheNamespace = next;
  apiCacheGeneration += 1;
  getMemoryCache.clear();
  // Do not let a request started for the previous account be deduplicated into
  // the new account. The underlying fetch may finish, but its promise is no
  // longer reachable through the dedupe map.
  getInFlight.clear();
}

export function getApiCacheNamespace() {
  return apiCacheNamespace;
}

function activeTelegramIdForRequest() {
  if (typeof window === "undefined") return null;
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) return null;
  try {
    const raw = new URLSearchParams(initData).get("user");
    if (!raw) return null;
    const user = JSON.parse(raw) as { id?: unknown } | null;
    const id = Number(user?.id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
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
  const { timeoutMs = 55_000, cacheMs, dedupe = true, retries, signal: callerSignal, ...requestInit } = init || {};
  const method = String(requestInit.method || "GET").toUpperCase();
  const isGet = method === "GET" && requestInit.body == null;
  const effectiveCacheMs = cacheMs ?? (isGet ? 2_500 : 0);
  const requestKey = `${apiCacheNamespace}:${method}:${input}`;
  const requestGeneration = apiCacheGeneration;
  const retryBudget = isGet ? Math.max(0, Math.min(2, retries ?? 1)) : 0;

  if (isGet) {
    const remembered = readRememberedGet<T>(requestKey);
    if (remembered !== null) return remembered;
    const pending = dedupe ? getInFlight.get(requestKey) : null;
    if (pending) return pending as Promise<T>;
  }

  const task = (async () => {
    const headers = new Headers(requestInit.headers);
    const activeTelegramId = activeTelegramIdForRequest();
    if (activeTelegramId && !headers.has("x-mxm-telegram-id")) headers.set("x-mxm-telegram-id", String(activeTelegramId));
    const isForm = typeof FormData !== "undefined" && requestInit.body instanceof FormData;
    if (requestInit.body && !isForm && !headers.has("content-type")) headers.set("content-type", "application/json");

    const startedAt = Date.now();
    apiPerf.inFlight += 1;
    let failed = false;

    try {
      for (let attempt = 0; attempt <= retryBudget; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));
        const abortFromCaller = () => controller.abort();
        if (callerSignal?.aborted) controller.abort();
        else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

        try {
          const response = await fetch(input, {
            ...requestInit,
            credentials: requestInit.credentials ?? "same-origin",
            headers,
            signal: controller.signal,
            cache: "no-store",
          });
          const payload: Record<string, unknown> = await response.json().catch(() => ({}));
          if (!response.ok) {
            const rawMessage = typeof payload.error === "string" ? payload.error : `Запрос не выполнен (${response.status})`;
            const code = typeof payload.code === "string" ? payload.code : null;
            const id = response.headers.get("x-mxm-request-id");
            if (typeof window !== "undefined" && input !== "/api/auth/telegram" && (response.status === 401 || code === "SESSION_ACCOUNT_MISMATCH")) {
              clearApiMemoryCache();
              window.dispatchEvent(new CustomEvent("mxm:auth-invalid", { detail: { status: response.status, code } }));
            }
            const transient = [408, 425, 502, 504].includes(response.status);
            if (transient && attempt < retryBudget && !callerSignal?.aborted) {
              await new Promise((resolve) => setTimeout(resolve, 140 * (2 ** attempt)));
              continue;
            }
            throw new ApiRequestError(localizeApiError(rawMessage), response.status, code, id);
          }
          if (isGet) {
            // A GET that started under an older account/cache generation may
            // finish after an account switch or mutation. Never let it cache
            // stale data, and never let it invalidate the fresh generation.
            if (requestGeneration === apiCacheGeneration) rememberGet(requestKey, payload, effectiveCacheMs);
          } else {
            clearApiMemoryCache();
          }
          return payload as T;
        } catch (error) {
          const timedOut = controller.signal.aborted && !callerSignal?.aborted;
          const retryableNetworkError = isGet
            && attempt < retryBudget
            && !callerSignal?.aborted
            && !(error instanceof ApiRequestError)
            && !timedOut;
          if (retryableNetworkError) {
            await new Promise((resolve) => setTimeout(resolve, 140 * (2 ** attempt)));
            continue;
          }
          if (timedOut) throw new Error("Сервер отвечает слишком долго. Повторите запрос.");
          throw error;
        } finally {
          clearTimeout(timeout);
          callerSignal?.removeEventListener("abort", abortFromCaller);
        }
      }
      throw new Error("Запрос не выполнен");
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      markCompleted(startedAt, failed);
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
