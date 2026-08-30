import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const authPath = path.join(root, "app", "api", "auth", "telegram", "route.ts");
const providerPath = path.join(root, "components", "telegram-provider.tsx");

let auth = fs.readFileSync(authPath, "utf8");
const rateBlock = `    if (!rateLimitAllowed) {\n      return NextResponse.json({ error: "Слишком много запросов авторизации. Повторите через минуту." }, { status: 429, headers: { "retry-after": "60" } });\n    }`;
if (auth.includes(rateBlock)) {
  auth = auth.replace(rateBlock, `    if (!rateLimitAllowed) {\n      // initData has already passed Telegram HMAC validation. A client retry\n      // storm must not lock the real user out of the Mini App. Keep the\n      // limiter as telemetry/abuse signal, but allow this idempotent profile\n      // synchronization to finish for a cryptographically verified identity.\n      console.warn("telegram auth soft rate limit reached", { telegramId: user.id });\n    }`);
}
fs.writeFileSync(authPath, auth);

let provider = fs.readFileSync(providerPath, "utf8");
const contextMarker = `const TelegramContext = createContext<TelegramContextValue | null>(null);\n`;
if (!provider.includes("telegramAuthSingleFlight")) {
  if (!provider.includes(contextMarker)) throw new Error("Telegram auth patch: context marker missing");
  provider = provider.replace(contextMarker, `${contextMarker}\nlet telegramAuthFlight: Promise<{ profile: Profile }> | null = null;\nlet telegramAuthFlightInitData = "";\n\nfunction telegramAuthSingleFlight(initData: string) {\n  if (telegramAuthFlight && telegramAuthFlightInitData === initData) return telegramAuthFlight;\n  telegramAuthFlightInitData = initData;\n  const request = apiFetch<{ profile: Profile }>("/api/auth/telegram", {\n    method: "POST",\n    body: JSON.stringify({ initData }),\n    dedupe: false,\n  });\n  telegramAuthFlight = request;\n  void request.finally(() => {\n    if (telegramAuthFlight === request) {\n      telegramAuthFlight = null;\n      telegramAuthFlightInitData = "";\n    }\n  }).catch(() => undefined);\n  return request;\n}\n`);
}

const directAuth = `        const result = await apiFetch<{ profile: Profile }>("/api/auth/telegram", {\n          method: "POST",\n          body: JSON.stringify({ initData: webApp.initData }),\n        });`;
if (provider.includes(directAuth)) {
  provider = provider.replace(directAuth, `        // React remounts, visibility events and auth-invalid recovery can overlap\n        // in Telegram WebViews. Share one POST across mounts instead of\n        // consuming the auth endpoint repeatedly for the same signed initData.\n        const result = await telegramAuthSingleFlight(webApp.initData);`);
}

fs.writeFileSync(providerPath, provider);
console.log("Telegram auth storm patch applied: verified users no longer hard-lock on 429 and auth POSTs are single-flight");
