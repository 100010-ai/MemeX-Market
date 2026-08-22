import fs from "node:fs";
import path from "node:path";

function load(file) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

load(".env");
load(".env.local");

const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
const blockId = String(process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID || "").trim();
const secret = String(process.env.ADSGRAM_REWARD_SECRET || "").trim();
const botUsername = String(process.env.NEXT_PUBLIC_BOT_USERNAME || "").trim().replace(/^@/, "");
const moderationMode = !/^(0|false|no|off)$/i.test(String(process.env.ADSGRAM_MODERATION_MODE || ""));
const sponsored = /^(1|true|yes|on)$/i.test(String(process.env.ENABLE_SPONSORED_TASKS || ""));
let failed = false;

function check(label, ok, detail = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

let validHttps = false;
try {
  const u = new URL(appUrl);
  validHttps = u.protocol === "https:" && Boolean(u.hostname) && !u.username && !u.password;
} catch {}

check("Public Mini App URL", validHttps, appUrl || "NEXT_PUBLIC_APP_URL missing");
check("AdsGram Reward block ID", /^\d+$/.test(blockId), blockId ? "must be numeric" : "NEXT_PUBLIC_ADSGRAM_BLOCK_ID missing");
check("AdsGram server reward secret", secret.length >= 32, secret ? `${secret.length} chars` : "ADSGRAM_REWARD_SECRET missing");
check("Telegram bot username", /^[A-Za-z0-9_]{5,}$/.test(botUsername), botUsername || "NEXT_PUBLIC_BOT_USERNAME missing");
check("AdsGram moderation lock enabled", moderationMode, moderationMode ? "safe default" : "set ADSGRAM_MODERATION_MODE=true");
check("Incentivized third-party tasks disabled", moderationMode && !sponsored, sponsored ? "set ENABLE_SPONSORED_TASKS=false" : "safe moderation default");

if (validHttps && secret.length >= 32) {
  console.log("\nReward URL to paste into AdsGram:");
  console.log(`${appUrl}/api/rewards/ads/adsgram?userid=[userId]&token=${encodeURIComponent(secret)}`);
}

console.log("\nBefore moderation:");
console.log("- BotFather Telegram direct link and Web App URL must exactly match the AdsGram platform.");
console.log("- Use Reward ad unit, not Interstitial, for the optional rewarded placement.");
console.log("- Production SDK must run without debug mode.");
console.log("- Open the Mini App from Telegram and verify market/profile/tasks work without watching an ad.");

process.exit(failed ? 1 : 0);
