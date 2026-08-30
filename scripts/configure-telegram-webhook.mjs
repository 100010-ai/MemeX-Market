const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const vercelEnv = String(process.env.VERCEL_ENV || "").trim().toLowerCase();

if (process.env.VERCEL && vercelEnv && vercelEnv !== "production") {
  console.log(`Telegram webhook setup skipped for Vercel ${vercelEnv} deployment`);
  process.exit(0);
}

const productionHost = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || "")
  .trim()
  .replace(/^https?:\/\//i, "")
  .replace(/\/$/, "");
const configuredAppUrl = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || "")
  .trim()
  .replace(/\/$/, "");
const appUrl = productionHost ? `https://${productionHost}` : configuredAppUrl;

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
if (!secret || secret.length < 16) throw new Error("TELEGRAM_WEBHOOK_SECRET must be at least 16 characters");
if (!/^https:\/\//i.test(appUrl)) throw new Error("A valid HTTPS production URL is required for Telegram webhook setup");

const webhookUrl = `${appUrl}/api/telegram/webhook`;
const allowedUpdates = ["message", "inline_query", "chosen_inline_result", "callback_query", "pre_checkout_query", "chat_member"];

async function telegram(method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || `${method} failed with HTTP ${response.status}`);
  }
  return payload.result;
}

await telegram("setWebhook", {
  url: webhookUrl,
  secret_token: secret,
  allowed_updates: allowedUpdates,
  drop_pending_updates: false,
});

const info = await telegram("getWebhookInfo");
if (!info || String(info.url || "") !== webhookUrl) {
  throw new Error(`Telegram webhook verification failed: expected ${webhookUrl}`);
}

const activeUpdates = Array.isArray(info.allowed_updates) ? info.allowed_updates : [];
for (const update of allowedUpdates) {
  if (activeUpdates.length && !activeUpdates.includes(update)) {
    throw new Error(`Telegram webhook verification failed: missing ${update} updates`);
  }
}

console.log("Telegram webhook configured and verified:", webhookUrl);
console.log("Telegram webhook allowed updates:", activeUpdates.join(", ") || "all");
console.log("Telegram webhook pending updates:", Number(info.pending_update_count || 0));
