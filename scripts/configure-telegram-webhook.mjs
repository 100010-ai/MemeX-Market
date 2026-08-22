const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || "").trim().replace(/\/$/, "");

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
if (!secret || secret.length < 16) throw new Error("TELEGRAM_WEBHOOK_SECRET must be at least 16 characters");
if (!/^https:\/\//i.test(appUrl)) throw new Error("NEXT_PUBLIC_APP_URL must be an HTTPS production URL");

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: `${appUrl}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message", "pre_checkout_query", "chat_member"],
    drop_pending_updates: false,
  }),
  signal: AbortSignal.timeout(12_000),
});

const payload = await response.json().catch(() => null);
if (!response.ok || !payload?.ok) throw new Error(payload?.description || `setWebhook failed with HTTP ${response.status}`);
console.log("Telegram webhook configured with chat_member updates:", `${appUrl}/api/telegram/webhook`);
