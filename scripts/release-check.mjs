import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
let failed = false;
const notes = [];

function check(label, condition, detail = "") {
  const ok = Boolean(condition);
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}
function exists(relative) { return fs.existsSync(path.join(root, relative)); }
function read(relative) { return exists(relative) ? fs.readFileSync(path.join(root, relative), "utf8") : ""; }
function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  check(label, result.status === 0, result.status == null ? "не удалось запустить" : `exit ${result.status}`);
}
function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, output); else output.push(absolute);
  }
  return output;
}
function secretLeaks() {
  const riskyNames = new Set([".env", ".env.local", ".env.production", ".env.development", ".mxm-control-secret"]);
  const patterns = [
    /\bsb_secret_[A-Za-z0-9_-]{20,}\b/,
    /\b\d{6,12}:[A-Za-z0-9_-]{25,}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ];
  const hits = [];
  for (const absolute of walk(root)) {
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    if (riskyNames.has(path.basename(absolute))) { hits.push(relative); continue; }
    if (relative === ".env.example" || fs.statSync(absolute).size > 2_000_000) continue;
    let text = "";
    try { text = fs.readFileSync(absolute, "utf8"); } catch { continue; }
    if (patterns.some((pattern) => pattern.test(text))) hits.push(relative);
  }
  return hits;
}

console.log("MXM v0.46 release gate\n");
const migration017 = read("supabase/migrations/017_v030_market_foundation.sql");
const migration018 = read("supabase/migrations/018_v040_games_speed_compact.sql");
const migration019 = read("supabase/migrations/019_v041_remove_games_interface.sql");
const migration020 = read("supabase/migrations/020_v045_economy_rewarded_ads.sql");
const migration021 = read("supabase/migrations/021_v046_stars_referrals_market_polish.sql");
const packageJson = read("package.json");
const packageLock = read("package-lock.json");
const marketPage = read("app/market/page.tsx");
const filters = read("components/gifts/gift-filters-drawer.tsx");
const tasks = read("app/tasks/page.tsx");
const adConfig = read("lib/rewarded-ads.ts");
const adCallback = read("app/api/rewards/ads/adsgram/route.ts");
const adClaim = read("app/api/rewards/ads/claim/route.ts");
const coinRoute = read("app/api/coins/route.ts");
const createPage = read("app/create/page.tsx");
const economy = read("lib/economy.ts");
const auth = read("lib/auth.ts");
const gifts = read("lib/gifts.ts");
const adminAction = read("app/api/admin/action/route.ts");
const envTemplate = read(".env.example");

check("Migration 017 present", Boolean(migration017));
check("Migration 018 present", Boolean(migration018));
check("Migration 019 present", Boolean(migration019));
check("Migration 020 v0.45 present", Boolean(migration020));
check("Migration 021 v0.46 present", Boolean(migration021));
check("v0.46 package version", packageJson.includes('"version": "0.46.0"'));
check("package-lock version synced", packageLock.includes('"version": "0.46.0"'));
check("Environment template present", Boolean(envTemplate));
check("No local .env.local in artifact", !exists(".env.local"));
check("No local control secret in artifact", !exists(".mxm-control-secret"));

check("Games removed from public API", !exists("app/api/games/route.ts") && !exists("app/api/games/play/route.ts"));
check("Games removed from navigation", !read("components/app-shell.tsx").includes('href: "/games"'));
check("Games disabled in DB", migration019.includes("daily_game_3") && migration019.includes("revoke execute on function public.play_virtual_game"));

check("Old market side dashboard removed", !marketPage.includes("MarketSide") && !marketPage.includes("Рынок сейчас") && !marketPage.includes("Медианный флор"));
check("One robust Gift filter drawer", marketPage.includes("GiftFiltersDrawer") && filters.includes("createPortal") && filters.includes("document.body"));
check("Misleading 25M launch copy removed", !/25[ ,.\u00a0]?000[ ,.\u00a0]?000|Стартовая позиция/i.test(createPage));
check("Current launch economics", economy.includes("COIN_LAUNCH_FEE_TON = 150") && economy.includes("COIN_MAX_ACTIVE_PER_CREATOR = 2") && economy.includes("COIN_LAUNCH_COOLDOWN_HOURS = 12"));
check("Coin launch waits for economy migration", coinRoute.includes("schema_version") && coinRoute.includes("экономика обновляется") && createPage.includes("economyReady"));
check("Coin create has no post-RPC visibility mutation", !coinRoute.includes('from("coins").update({ status: "active"'));

check("Rewarded ad economics", economy.includes("REWARDED_AD_REWARD_TON = 50") && economy.includes("REWARDED_AD_DAILY_LIMIT = 5") && economy.includes("REWARDED_AD_COOLDOWN_MINUTES = 30"));
check("AdsGram SDK integration", tasks.includes("https://sad.adsgram.ai/js/sad.min.js") && tasks.includes("Adsgram.init") && tasks.includes("shown.done"));
check("Server reward callback", exists("app/api/rewards/ads/adsgram/route.ts") && adCallback.includes("claim_rewarded_ad_by_telegram_v045"));
check("Reward callback secret uses timing-safe comparison", adConfig.includes("timingSafeEqual") && adCallback.includes("safeSecretEquals"));
check("AdsGram config validates block/secret", adConfig.includes("/^\\d+$/") && adConfig.includes("rawServerSecret.length >= 32"));
check("Client ad fallback is impossible in production", adConfig.includes('process.env.NODE_ENV !== "production" && fallbackRequested'));
check("Server-mode client cannot directly credit reward", adClaim.includes('verificationMode === "client"') && !adClaim.includes("finalize_rewarded_ad_v045"));
check("Old forgeable v0.44 ad RPCs removed", migration020.includes("drop function if exists public.claim_rewarded_ad_session_v044"));
check("Reward session concurrency guard", migration020.includes("rewarded_ad_sessions_one_open_v045_idx") && migration020.includes("row_number() over(partition by profile_id"));
check("Ad secret is server-only", envTemplate.includes("ADSGRAM_REWARD_SECRET") && !/NEXT_PUBLIC_ADSGRAM_REWARD_SECRET/.test(envTemplate));
check("Client fallback is off by default", envTemplate.includes("ADSGRAM_ALLOW_CLIENT_FALLBACK=false"));
check("Telegram Stars invoice endpoint", exists("app/api/stars/invoice/route.ts") && read("app/api/stars/invoice/route.ts").includes('currency: "XTR"'));
check("Telegram Stars webhook verifier", exists("app/api/telegram/webhook/route.ts") && read("app/api/telegram/webhook/route.ts").includes("x-telegram-bot-api-secret-token") && read("app/api/telegram/webhook/route.ts").includes("finalize_star_purchase_v046"));
check("Referral graph + idempotent rewards", migration021.includes("referrer_profile_id") && migration021.includes("referral_rewards_once_v046_uidx") && migration021.includes("credit_referral_bonus_v046"));
check("Rewarded ads capped at five/day", migration021.includes("rewarded_ad_daily_limit=5") && economy.includes("REWARDED_AD_DAILY_LIMIT = 5"));
check("Full-market filter dictionary", migration021.includes("gift_market_filter_options_v046") && read("app/api/market/route.ts").includes("gift_market_filter_options_v046"));
check("Referral link auth binding", read("app/api/auth/telegram/route.ts").includes("attach_referrer_v046"));

check("PnL uses realized trading PnL", auth.includes("pnl: finance.realizedPnl") && !auth.includes("netWorth - 100"));
check("Economy audit ledger", migration020.includes("create table if not exists public.economy_events") && read("app/api/admin/overview/route.ts").includes("economyEmissionToday"));
check("AMM trade fee sink is audited", migration020.includes("log_coin_trade_fee_v045") && read("app/api/admin/overview/route.ts").includes("tradeFeeSinkToday"));
check("Admin economy update is atomic", migration020.includes("update_economy_settings_v045") && adminAction.includes('supabase.rpc("update_economy_settings_v045"'));
check("Gift market fee treasury", migration020.includes("MXM Treasury") && migration020.includes("gift_fee_bps"));

check("Telegram Gift download timeout", gifts.includes("AbortSignal.timeout(TELEGRAM_FILE_TIMEOUT_MS)"));
check("Telegram Gift file-size bound", gifts.includes("MAX_TELEGRAM_GIFT_FILE_BYTES") && gifts.includes("content-length"));
check("TGS decompression bound", gifts.includes("MAX_TGS_JSON_BYTES") && gifts.includes("maxOutputLength"));

check("Gift resolver present", exists("lib/gifts/resolver.ts"));
check("TonAPI resilient client present", exists("lib/providers/tonapi-client.ts"));
check("Market health endpoint present", exists("app/api/system/market-health/route.ts"));
check("Atomic single-Gift purchase RPC present", migration017.includes("buy_virtual_gift_v2"));
check("Atomic cart purchase RPC present", migration017.includes("buy_virtual_gift_cart_v2"));
check("Fast session snapshot RPC", migration018.includes("session_profile_snapshot_v040") && auth.includes("getSessionProfileSnapshot"));

check("Public env does not expose service role", !/NEXT_PUBLIC_(?:SUPABASE_)?(?:SECRET|SERVICE_ROLE)/i.test(envTemplate));
const leaks = secretLeaks();
check("No probable literal secrets in artifact", leaks.length === 0, leaks.length ? leaks.slice(0, 5).join(", ") : "");

run("TypeScript", process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit"]);
run("ESLint", process.execPath, [path.join(root, "node_modules/eslint/bin/eslint.js"), "."]);

if (!process.env.TONAPI_KEY) notes.push("TONAPI_KEY не задан в shell: каталог перейдёт на публичный rate limit TonAPI.");
if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) notes.push("Supabase env не загружен в этой shell-сессии; проверьте production env перед deploy.");
if (!process.env.TELEGRAM_BOT_TOKEN) notes.push("TELEGRAM_BOT_TOKEN не загружен в этой shell-сессии.");
if (!process.env.NEXT_PUBLIC_ADSGRAM_BLOCK_ID) notes.push("NEXT_PUBLIC_ADSGRAM_BLOCK_ID не задан в shell: rewarded ad останется скрыто/недоступно до настройки.");
if (!process.env.ADSGRAM_REWARD_SECRET) notes.push("ADSGRAM_REWARD_SECRET не задан в shell: production server verification rewarded ads нужно настроить.");
notes.push("npm audit требует доступ к registry.npmjs.org; если CI имеет сеть, запустите npm audit --omit=dev отдельно.");

if (notes.length) {
  console.log("\nNOTES");
  for (const note of notes) console.log(`- ${note}`);
}
console.log(`\n${failed ? "RELEASE BLOCKED" : "STATIC RELEASE CHECK PASSED"}`);
process.exit(failed ? 1 : 0);
