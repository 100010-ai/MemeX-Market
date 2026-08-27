const TONAPI_BASE = "https://tonapi.io";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_ATTEMPTS = 2;
const PUBLIC_INTERVAL_MS = 4_150;
const CACHE_LIMIT = 300;

type CacheEntry = { expiresAt: number; value: unknown };
type HealthState = {
  consecutiveFailures: number;
  circuitOpenUntil: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  authFallbacks: number;
  requests: number;
  cacheHits: number;
  coalesced: number;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
const health: HealthState = {
  consecutiveFailures: 0,
  circuitOpenUntil: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  authFallbacks: 0,
  requests: 0,
  cacheHits: 0,
  coalesced: 0,
};
let publicNextRequestAt = 0;
let publicQueue = Promise.resolve();

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function respectPublicLimit(authenticated: boolean) {
  if (authenticated) return;
  const previous = publicQueue;
  let release!: () => void;
  publicQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const wait = Math.max(0, publicNextRequestAt - Date.now());
    if (wait) await sleep(wait);
    publicNextRequestAt = Date.now() + PUBLIC_INTERVAL_MS;
  } finally {
    release();
  }
}

function retryDelay(attempt: number, retryAfter: string | null) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5_000, Math.max(250, seconds * 1000));
  const base = 320 * (2 ** attempt);
  return Math.min(4_000, base + Math.floor(Math.random() * 180));
}

function rememberFailure(error: Error) {
  health.consecutiveFailures += 1;
  health.lastFailureAt = Date.now();
  health.lastError = error.message;
  if (health.consecutiveFailures >= 3) health.circuitOpenUntil = Date.now() + 30_000;
}

function rememberSuccess() {
  health.consecutiveFailures = 0;
  health.circuitOpenUntil = 0;
  health.lastSuccessAt = Date.now();
  health.lastError = null;
}

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  health.cacheHits += 1;
  cache.delete(key);
  cache.set(key, entry);
  return entry.value as T;
}

function cachePut(key: string, value: unknown, ttlMs: number) {
  if (ttlMs <= 0) return;
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export type TonApiRequestOptions = {
  timeoutMs?: number;
  cacheTtlMs?: number;
  attempts?: number;
  allowStaleOnFailure?: boolean;
};

export async function tonApiGet<T>(path: string, options: TonApiRequestOptions = {}): Promise<T> {
  if (!path.startsWith("/v2/")) throw new Error("TonAPI path must start with /v2/");
  const cacheKey = `GET:${path}`;
  // Capture the last value before cacheGet evicts an expired entry so a
  // transient provider outage can still serve stale metadata when requested.
  const staleValue = cache.get(cacheKey)?.value as T | undefined;
  const cached = cacheGet<T>(cacheKey);
  if (cached) return cached;

  const pending = inFlight.get(cacheKey);
  if (pending) {
    health.coalesced += 1;
    return pending as Promise<T>;
  }

  const task = (async () => {
    const stale = staleValue;
    if (health.circuitOpenUntil > Date.now()) {
      if (options.allowStaleOnFailure && stale !== undefined) return stale;
      throw new Error(`TonAPI circuit is temporarily open (${Math.ceil((health.circuitOpenUntil - Date.now()) / 1000)}s)`);
    }

    const configuredKey = process.env.TONAPI_KEY?.trim();
    let authenticated = Boolean(configuredKey);
    let authFallbackUsed = false;
    const attempts = Math.max(1, Math.min(5, options.attempts ?? DEFAULT_ATTEMPTS));
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
      try {
        await respectPublicLimit(authenticated);
        health.requests += 1;
        const headers: Record<string, string> = {
          accept: "application/json",
          "user-agent": "MXM-Market/0.30",
        };
        if (authenticated && configuredKey) headers.authorization = `Bearer ${configuredKey}`;
        const response = await fetch(`${TONAPI_BASE}${path}`, { headers, signal: controller.signal, cache: "no-store" });
        if (response.ok) {
          const value = await response.json() as T;
          rememberSuccess();
          cachePut(cacheKey, value, options.cacheTtlMs ?? 20_000);
          return value;
        }

        if ((response.status === 401 || response.status === 403) && authenticated && !authFallbackUsed) {
          authenticated = false;
          authFallbackUsed = true;
          health.authFallbacks += 1;
          continue;
        }

        const error = new Error(`TonAPI ${response.status} for ${path}`);
        const transient = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
        lastError = error;
        if (!transient || attempt === attempts - 1) throw error;
        await sleep(retryDelay(attempt, response.headers.get("retry-after")));
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error("TonAPI request failed");
        lastError = error;
        const transient = error.name === "AbortError" || /fetch|network|timeout|TonAPI (408|425|429|5\d\d)/i.test(error.message);
        if (!transient || attempt === attempts - 1) {
          rememberFailure(error);
          if (options.allowStaleOnFailure && stale !== undefined) return stale;
          throw error;
        }
        await sleep(retryDelay(attempt, null));
      } finally {
        clearTimeout(timeout);
      }
    }

    const error = lastError || new Error("TonAPI request failed");
    rememberFailure(error);
    if (options.allowStaleOnFailure && stale !== undefined) return stale;
    throw error;
  })();

  inFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    if (inFlight.get(cacheKey) === task) inFlight.delete(cacheKey);
  }
}

export function tonApiHealth() {
  return {
    ...health,
    circuitOpen: health.circuitOpenUntil > Date.now(),
    circuitRetryInMs: Math.max(0, health.circuitOpenUntil - Date.now()),
    cacheEntries: cache.size,
    inFlight: inFlight.size,
    authenticatedConfigured: Boolean(process.env.TONAPI_KEY?.trim()),
  };
}

export function clearTonApiMemoryCache() {
  cache.clear();
}
