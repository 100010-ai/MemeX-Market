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

function exists(relative) {
  return fs.existsSync(path.join(root, relative));
}

function read(relative) {
  return exists(relative) ? fs.readFileSync(path.join(root, relative), "utf8") : "";
}

function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  check(label, result.status === 0, result.status == null ? "не удалось запустить" : `exit ${result.status}`);
}

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else output.push(absolute);
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

console.log("MXM release gate\n");
const migration = read("supabase/migrations/017_v030_market_foundation.sql");
const migration040 = read("supabase/migrations/018_v040_games_speed_compact.sql");
const marketRoute = read("app/api/market/route.ts");
const mediaRoute = read("app/api/gifts/media/[assetId]/route.ts");
const auth = read("lib/auth.ts");
const giftDetail = read("components/gifts/gift-detail.tsx");
const giftCandles = read("app/api/gifts/[id]/candles/route.ts");
const clientApi = read("lib/api.ts");
check("Migration 017 present", Boolean(migration));
check("Migration 018 present", Boolean(migration040));
check("v0.43 package version", read("package.json").includes('"version": "0.43.0"'));
check("Environment template present", exists(".env.example"));
check("No local .env.local in artifact", !exists(".env.local"));
check("No local control secret in artifact", !exists(".mxm-control-secret"));
check("Russian production admin present", exists("app/api/admin/overview/route.ts") && exists("app/api/admin/action/route.ts") && read("app/admin/page.tsx").includes("АДМИН-ПАНЕЛЬ"));
check("Admin mutations protected", read("app/api/admin/action/route.ts").includes("requireAdminProfile") && read("app/api/admin/action/route.ts").includes("sameOriginMutation") && read("app/api/admin/action/route.ts").includes("enforceRateLimit"));

check("Gift resolver present", exists("lib/gifts/resolver.ts"));
check("TonAPI resilient client present", exists("lib/providers/tonapi-client.ts"));
check("Market health endpoint present", exists("app/api/system/market-health/route.ts"));
check("Games removed from public API", !exists("app/api/games/route.ts") && !exists("app/api/games/play/route.ts"));
check("Games removed from navigation", !read("components/app-shell.tsx").includes('href: "/games"'));
check("Games disabled in DB", read("supabase/migrations/019_v041_remove_games_interface.sql").includes("daily_game_3") && read("supabase/migrations/019_v041_remove_games_interface.sql").includes("revoke execute on function public.play_virtual_game"));
check("Atomic single-Gift purchase RPC present", migration.includes("buy_virtual_gift_v2"));
check("Atomic cart purchase RPC present", migration.includes("buy_virtual_gift_cart_v2"));
check("Fresh external quote guard present", migration.includes("external_quote_hours") && migration.includes("resale_seen_at"));
check("Finite Genesis RPC present", migration.includes("initialize_gift_genesis_pool") && migration.includes("genesis_market_candidates"));
check("Fast session snapshot RPC", migration040.includes("session_profile_snapshot_v040") && auth.includes("getSessionProfileSnapshot"));
check("DB-side TonAPI rarity aggregation", migration040.includes("recalculate_tonapi_collection_rarity_v040"));
check("Lean Gift pagination", marketRoute.includes("lean") && marketRoute.includes("gift_market_random_page"));
check("Gift media slug fast-path", mediaRoute.includes('searchParams.get("slug")'));
check("Lazy NFT chart endpoint", giftCandles.includes("gift_collection_candles") && giftDetail.includes("/candles"));
check("Lazy NFT chart bundle", giftDetail.includes('dynamic(() => import("@/components/coin-chart")'));
check("Current launch-fee copy", clientApi.includes("250 виртуальных TON") && !clientApi.includes("нужно 50 виртуальных TON"));

const envTemplate = read(".env.example");
check("Public env does not expose service role", !/NEXT_PUBLIC_(?:SUPABASE_)?(?:SECRET|SERVICE_ROLE)/i.test(envTemplate));
const leaks = secretLeaks();
check("No probable literal secrets in artifact", leaks.length === 0, leaks.length ? leaks.slice(0, 5).join(", ") : "");

run("TypeScript", process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit"]);
run("ESLint", process.execPath, [path.join(root, "node_modules/eslint/bin/eslint.js"), "."]);

if (!process.env.TONAPI_KEY) notes.push("TONAPI_KEY не задан: каталог работает через публичный лимит TonAPI и будет синхронизироваться медленнее.");
if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) notes.push("Supabase env не загружен в этой shell-сессии; production env нужно проверить в Vercel/Railway.");
if (!process.env.TELEGRAM_BOT_TOKEN) notes.push("TELEGRAM_BOT_TOKEN не загружен в этой shell-сессии.");

if (notes.length) {
  console.log("\nNOTES");
  for (const note of notes) console.log(`- ${note}`);
}

console.log(`\n${failed ? "RELEASE BLOCKED" : "STATIC RELEASE CHECK PASSED"}`);
process.exit(failed ? 1 : 0);
