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
function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", shell: false });
  if (result.status === 0) return result.stdout.split("\0").filter(Boolean).map((relative) => relative.replaceAll("\\", "/"));

  // Release archives are often checked before `git init`. Do not let the secret
  // scanner silently become a no-op just because .git is absent.
  const out = [];
  const ignoredDirs = new Set(["node_modules", ".next", ".git"]);
  const walk = (directory, prefix = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) out.push(relative.replaceAll("\\", "/"));
    }
  };
  walk(root);
  return out;
}
function secretLeaks() {
  const riskyNames = new Set([".env", ".env.local", ".env.production", ".env.development", ".mxm-control-secret"]);
  const patterns = [
    /\bsb_secret_[A-Za-z0-9_-]{20,}\b/,
    /\b\d{6,12}:[A-Za-z0-9_-]{25,}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ];
  const hits = [];
  for (const relative of trackedFiles()) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) continue;
    if (riskyNames.has(path.basename(absolute))) { hits.push(relative); continue; }
    if (relative === ".env.example" || fs.statSync(absolute).size > 2_000_000) continue;
    let text = "";
    try { text = fs.readFileSync(absolute, "utf8"); } catch { continue; }
    if (patterns.some((pattern) => pattern.test(text))) hits.push(relative);
  }
  return hits;
}

console.log("MXM release gate\n");
const migration017 = read("supabase/migrations/017_v030_market_foundation.sql");
const migration018 = read("supabase/migrations/018_v040_games_speed_compact.sql");
const migration019 = read("supabase/migrations/019_v041_remove_games_interface.sql");
const migration020 = read("supabase/migrations/020_v045_economy_rewarded_ads.sql");
const migration021 = read("supabase/migrations/021_v046_stars_referrals_market_polish.sql");
const migration022 = read("supabase/migrations/022_v047_sponsored_tasks_admin_marketing.sql");
const migration023 = read("supabase/migrations/023_v048_watchlist_notifications_profiles.sql");
const migration024 = read("supabase/migrations/024_v049_sweep_bulk_quality.sql");
const migration025 = read("supabase/migrations/025_v050_adsgram_moderation.sql");
const migration026 = read("supabase/migrations/026_v056_quality_market_orders_admin.sql");
const migration027Name = fs.readdirSync(path.join(root, "supabase/migrations")).find((name) => name.startsWith("027_")) || "";
const migration027 = migration027Name ? read(`supabase/migrations/${migration027Name}`) : "";
const migration028 = read("supabase/migrations/028_remove_advertising.sql");
const migration029 = read("supabase/migrations/029_market_scalability.sql");
const migration9994 = read("supabase/migrations/9994_mrkt_player_market_handoff.sql");
const packageJson = read("package.json");
const marketPage = read("app/market/page.tsx");
const filters = read("components/gifts/gift-filters-drawer.tsx");
const tasks = read("app/tasks/page.tsx");
const coinRoute = read("app/api/coins/route.ts");
const createPage = read("app/create/page.tsx");
const economy = read("lib/economy.ts");
const auth = read("lib/auth.ts");
const gifts = read("lib/gifts.ts");
const adminAction = read("app/api/admin/action/route.ts");
const adminOverview = read("app/api/admin/overview/route.ts");
const adminPage = read("app/admin/page.tsx");
const envTemplate = read(".env.example");
const aboutPage = read("app/about/page.tsx");
const runtimeConfig = read("lib/runtime-config.ts");
const notificationsApi = read("app/api/notifications/route.ts");
const supportPage = read("app/paysupport/page.tsx");
const supportConfig = read("lib/support.ts");
const webhookRoute = read("app/api/telegram/webhook/route.ts");
const npcMarket = read("lib/npc-market.ts");
const marketCollectionsRoute = read("app/api/market/collections/route.ts");
const bulkCartRoute = read("app/api/cart/bulk/route.ts");
const giftsBootstrapRoute = read("app/api/gifts/bootstrap/route.ts");
const sweepRoute = read("app/api/collections/[name]/sweep/route.ts");
const marketSearchRoute = read("app/api/market/search/route.ts");
const looseQuery = read("lib/supabase/loose-query.ts");
const giftMediaRoute = read("app/api/gifts/media/[assetId]/route.ts");
const httpBody = read("lib/http-body.ts");
const telegramAvatarRoute = read("app/api/telegram/avatar/route.ts");
const telegramFileRoute = read("app/api/telegram/file/[fileId]/route.ts");

function normalizedTelegramUsername(value) {
  return String(value || "").trim().replace(/^@+/, "");
}

check("Migration 017 present", Boolean(migration017));
check("Migration 018 present", Boolean(migration018));
check("Migration 019 present", Boolean(migration019));
check("Migration 020 v0.45 present", Boolean(migration020));
check("Migration 021 v0.46 present", Boolean(migration021));
check("Migration 022 v0.47 present", Boolean(migration022));
check("Migration 023 v0.48 present", Boolean(migration023));
check("Migration 024 v0.49 present", Boolean(migration024));
check("Migration 025 v0.50 present", Boolean(migration025));
check("Migration 026 v0.56 present", Boolean(migration026));
check("Migration 027 present", Boolean(migration027), migration027Name || "missing");
check("Migration 028 advertising teardown present", Boolean(migration028));
check("Migration 029 scalable market present", Boolean(migration029));
check("Migration 9994 player market handoff present", Boolean(migration9994));
check("Migration 9995 player-only consistency present", exists("supabase/migrations/9995_mrkt_player_only_consistency.sql"));
check("Migration 9996 resilient Gift sync present", exists("supabase/migrations/9996_gift_sync_resilience.sql"));
check("Migration 9997 Telegram channel task present", exists("supabase/migrations/9997_main_channel_subscription_task.sql"));
check("v0.56 package version", packageJson.includes('"version": "0.56.0"'));
check("pnpm package manager pinned", packageJson.includes('"packageManager": "pnpm@') && exists("pnpm-lock.yaml") && !exists("package-lock.json"));

check("Runtime config schema", migration026.includes("create table if not exists public.runtime_config_v056") && exists("lib/runtime-config.ts") && exists("app/api/runtime-config/route.ts"));
check("Maintenance mode + feature flags", read("components/app-shell.tsx").includes("maintenanceMode") && read("app/api/admin/runtime-config/route.ts").includes("validateRuntimeConfigInput"));
check("Advanced Gift offers", migration026.includes("advanced_gift_offers_v056") && migration026.includes("create_advanced_gift_offer_v056") && migration026.includes("accept_advanced_gift_offer_v056") && exists("components/gifts/advanced-offers-panel.tsx"));
check("Conditional memecoin orders", migration026.includes("coin_conditional_orders_v056") && exists("components/coin-conditional-orders.tsx") && exists("app/api/system/coin-orders/route.ts"));
check("Command palette", exists("components/command-palette.tsx") && read("components/app-shell.tsx").includes("<CommandPalette"));
check("Admin Economy & Risk", exists("app/admin/economy-risk/page.tsx") && exists("app/api/admin/economy-risk/route.ts"));
check("Admin Health Center", exists("app/admin/health/page.tsx") && exists("app/api/admin/health/route.ts"));
check("Error Inbox infrastructure", exists("lib/error-inbox.ts") && migration026.includes("error_inbox_v056"));

check("Environment template present", Boolean(envTemplate));
check("Human support username documented", /^SUPPORT_TELEGRAM_USERNAME=@?[A-Za-z0-9_]{5,32}$/m.test(envTemplate));
check("Payment support never falls back to the bot",
  supportPage.includes("getHumanSupportUsername")
  && supportPage.includes("<a href={humanSupportTelegramUrl(support)}")
  && supportConfig.includes("https://t.me/")
  && supportConfig.includes("username.toLowerCase() === botUsername.toLowerCase()")
  && webhookRoute.includes("getHumanSupportUsername")
  && !/SUPPORT_TELEGRAM_USERNAME\s*\|\|\s*["']@?MemeXMarketBot/i.test(`${supportPage}\n${webhookRoute}`)
);
const productionRelease = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
if (productionRelease) {
  const supportUsername = normalizedTelegramUsername(process.env.SUPPORT_TELEGRAM_USERNAME);
  const botUsername = normalizedTelegramUsername(process.env.NEXT_PUBLIC_BOT_USERNAME);
  check("Production human support username configured",
    /^[A-Za-z0-9_]{5,32}$/.test(supportUsername)
    && (!botUsername || supportUsername.toLowerCase() !== botUsername.toLowerCase())
  );
}
const tracked = new Set(trackedFiles());
check("No local .env.local tracked", !tracked.has(".env.local"));
check("No local control secret tracked", !tracked.has(".mxm-control-secret"));

check("Games removed from public API", !exists("app/api/games/route.ts") && !exists("app/api/games/play/route.ts"));
check("Games removed from navigation", !read("components/app-shell.tsx").includes('href: "/games"'));
check("Games disabled in DB", migration019.includes("daily_game_3") && migration019.includes("revoke execute on function public.play_virtual_game"));

check("Old market side dashboard removed", !marketPage.includes("MarketSide") && !marketPage.includes("Рынок сейчас") && !marketPage.includes("Медианный флор"));
check("One robust Gift filter drawer", marketPage.includes("GiftFiltersDrawer") && filters.includes("createPortal") && filters.includes("document.body"));
check("Misleading 25M launch copy removed", !/25[ ,.\u00a0]?000[ ,.\u00a0]?000|Стартовая позиция/i.test(createPage));
check("Current launch economics", economy.includes("COIN_LAUNCH_FEE_TON = 150") && economy.includes("COIN_MAX_ACTIVE_PER_CREATOR = 2") && economy.includes("COIN_LAUNCH_COOLDOWN_HOURS = 12"));
check("Coin launch waits for economy migration", coinRoute.includes("schema_version") && coinRoute.includes("экономика обновляется") && createPage.includes("economyReady"));
check("Coin create has no post-RPC visibility mutation", !coinRoute.includes('from("coins").update({ status: "active"'));

const retiredAdvertisingFiles = [
  "app/api/rewards/ads/adsgram/route.ts",
  "app/api/rewards/ads/claim/route.ts",
  "app/api/rewards/ads/session/route.ts",
  "app/api/rewards/ads/status/route.ts",
  "app/api/sponsored-tasks/route.ts",
  "app/api/public/reward-confirmations/route.ts",
  "app/reward-confirmations/page.tsx",
  "app/moderation/page.tsx",
  "lib/adsgram-url.ts",
  "lib/rewarded-ads.ts",
  "lib/sponsored-tasks.ts",
  "lib/feature-flags.ts",
  "scripts/adsgram-check.mjs",
  "ADSGRAM_MODERATION.md",
  "docs/ADS_REWARDED_SETUP_V045.md",
  "docs/ADMIN_MARKETING_V047.md",
];
const retiredAdvertisingPattern = /(adsgram|reward(?:ed)?[_-]?ads?|sponsored[_-]?(?:tasks?|campaigns?)|enable_sponsored_tasks|реклам)/i;
const liveAdvertisingReferences = trackedFiles()
  .filter((relative) => exists(relative))
  .filter((relative) => relative === ".env.example" || relative === "package.json" || /^(app|components|lib|scripts)\//.test(relative))
  .filter((relative) => relative !== "scripts/release-check.mjs" && relative !== "scripts/cleanup-retired-source.mjs")
  .filter((relative) => retiredAdvertisingPattern.test(read(relative)));

check("Advertising routes, helpers, pages and setup docs removed", retiredAdvertisingFiles.every((relative) => !exists(relative)), retiredAdvertisingFiles.filter(exists).join(", "));
check("No live advertising code or configuration references", liveAdvertisingReferences.length === 0, liveAdvertisingReferences.slice(0, 8).join(", "));
check("Tasks contain missions only", !retiredAdvertisingPattern.test(tasks) && tasks.includes("/api/tasks/claim"));
check("Runtime advertising flags removed", !/rewardedAds|sponsoredTasks/.test(runtimeConfig));
check("Advertising environment variables removed", !/ADSGRAM_|NEXT_PUBLIC_ADSGRAM|ENABLE_SPONSORED_TASKS/.test(envTemplate));
check("Advertising notification preference removed", !/sponsored_task/.test(notificationsApi));
check("Advertising package script removed", !packageJson.includes("adsgram:check"));
check("Migration 028 drops advertising data paths",
  migration028.includes("drop table if exists public.rewarded_ad_sessions")
  && migration028.includes("drop table if exists public.sponsored_task_claims")
  && migration028.includes("drop table if exists public.sponsored_campaigns")
  && migration028.includes("drop column if exists rewarded_ad_reward")
  && migration028.includes("feature_flags - 'rewardedAds' - 'sponsoredTasks'")
  && migration028.includes("economy_events_kind_v028_check")
  && migration028.includes("referral_rewards_source_kind_v028_check")
);
check("Virtual TON disclosure is visible", aboutPage.includes("не выводится") && aboutPage.includes("денежной стоимости"));
check("Telegram Stars invoice endpoint", exists("app/api/stars/invoice/route.ts") && read("app/api/stars/invoice/route.ts").includes('currency: "XTR"'));
check("Telegram channel subscription task is server-verified",
  exists("lib/telegram-membership.ts")
  && exists("app/api/tasks/channel/route.ts")
  && exists("app/api/system/channel-subscription-audit/route.ts")
  && webhookRoute.includes("chat_member")
  && webhookRoute.includes("applyMainChannelMembership")
  && read("supabase/migrations/9997_main_channel_subscription_task.sql").includes("settle_main_channel_clawback_v700")
  && packageJson.includes("telegram:webhook")
);
check("Telegram Stars webhook verifier",
  exists("app/api/telegram/webhook/route.ts")
  && webhookRoute.includes("x-telegram-bot-api-secret-token")
  && webhookRoute.includes("authorize_star_precheckout_v200")
  && webhookRoute.includes("finalize_star_purchase_v200")
  && webhookRoute.includes("payer_telegram_id")
);
check("Stars reservation cleanup has a visible-store entry point",
  migration027.includes("release_expired_star_authorizations_v200")
  && read("app/api/store/route.ts").includes("release_expired_star_authorizations_v200")
  && read("app/api/stars/invoice/route.ts").includes("release_expired_star_authorizations_v200")
);
check("Referral graph + idempotent rewards", migration021.includes("referrer_profile_id") && migration021.includes("referral_rewards_once_v046_uidx") && migration021.includes("credit_referral_bonus_v046"));
check("Full-market filter dictionary", migration021.includes("gift_market_filter_options_v046") && read("app/api/market/route.ts").includes("gift_market_filter_options_v046"));
check("Catalogue-wide indexed market paging",
  migration029.includes("market_shuffle_key")
  && migration029.includes("gift_market_filtered_page_v200")
  && read("app/api/market/route.ts").includes("gift_market_filtered_page_v200")
);
check("NPC liquidity has irreversible player-only handoff",
  migration9994.includes("gift_market_liquidity_policy")
  && migration9994.includes("maybe_handoff_gift_market_to_players")
  && migration9994.includes("enforce_player_only_gift_listing")
  && migration9994.includes("mode='player_only'")
  && npcMarket.includes("evaluatePlayerMarketHandoff")
  && giftsBootstrapRoute.includes("playerOnly")
);
check("Player-only market filters stale system listings",
  migration9994.includes("policy.mode<>'player_only' or coalesce(owner_profile.is_system,false)=false")
  && read("app/api/market/search/route.ts").includes("playerOnly")
  && read("app/api/cart/route.ts").includes("NPC liquidity is disabled")
  && read("app/api/collections/[name]/sweep/route.ts").includes("playerOnly")
);
check("MRKT-style collections + activity feed are real-data backed",
  migration9994.includes("gift_market_collection_cards_v210")
  && marketCollectionsRoute.includes("gift_market_collection_cards_v210")
  && marketPage.includes('GiftMarketMode = "items" | "collections" | "feed"')
  && marketPage.includes("MarketCollectionsView")
  && marketPage.includes("MarketFeedView")
  && read("lib/feed.ts").includes("gift_listing_events")
);
check("Collection preview basket uses validated bulk cart",
  Boolean(bulkCartRoute)
  && bulkCartRoute.includes("market_cart_items")
  && bulkCartRoute.includes("getGiftMarketLiquidityState")
  && marketPage.includes("addCollectionPreviewToCart")
);
check("Admin can tune thresholds or force irreversible handoff",
  migration9994.includes("configure_gift_market_liquidity_policy")
  && adminAction.includes('action === "npc.policy"')
  && adminAction.includes('action === "npc.handoff"')
  && adminPage.includes("Переход на рынок игроков")
);
check("Paid Coin Boost is visible in New Coins",
  migration029.includes("active_coin_boosts_v200")
  && read("app/api/market/route.ts").includes("boostedUntil")
  && marketPage.includes("Boost")
  && marketPage.includes("bBoost - aBoost")
  && migration027.includes("coin-boost-capacity-v200")
  && migration027.includes("boost_capacity_full")
  && migration027.includes("memecoins_disabled")
  && migration027.includes("hidden_from_market,false")
  && read("app/api/stars/invoice/route.ts").includes('eq("hidden_from_market", false)')
  && read("app/api/store/route.ts").includes("runtimeConfig.featureFlags.memecoins")
  && read("components/store-front.tsx").includes("starsEnabled")
);
check("Referral link auth binding", read("app/api/auth/telegram/route.ts").includes("attach_referrer_v046"));
check("Promo codes", migration022.includes("promo_codes") && exists("app/api/promo/route.ts"));

check("PnL uses realized trading PnL", /pnl:\s*(?:safeNumber\()?finance\.realizedPnl/.test(auth) && !auth.includes("netWorth - 100"));
check("Economy audit ledger", migration020.includes("create table if not exists public.economy_events") && migration028.includes("economyEmissionToday") && read("app/api/admin/overview/route.ts").includes("admin_dashboard_metrics_v028"));
check("AMM trade fee sink is audited", migration020.includes("log_coin_trade_fee_v045") && migration028.includes("tradeFeeSinkToday") && read("app/api/admin/overview/route.ts").includes("admin_dashboard_metrics_v028"));
check("Admin economy update excludes retired settings", adminAction.includes('.from("economy_settings")') && !/rewardedAd|rewarded_ad/.test(adminAction));
check("Admin overview uses bounded lists + DB aggregates", read("app/api/admin/overview/route.ts").includes("LIST_LIMITS") && read("app/api/admin/overview/route.ts").includes("admin_dashboard_metrics_v028"));
check("Admin growth, turnover and top-list metrics are bounded and surfaced",
  migration028.includes("activity_events(profile_id,created_at) as materialized")
  && migration028.includes("created_at>=now()-interval '60 days'")
  && migration028.includes("'retention30dPercent'")
  && migration028.includes("'tradeTurnover24h'")
  && migration028.includes("'topGiftCollections'")
  && migration028.includes("'topCoins'")
  && migration028.includes("'topStoreSkus'")
  && migration028.includes("limit 5")
  && adminPage.includes("AdminPerformanceSnapshot")
  && adminPage.includes("DAU/MAU")
);
check("Admin expensive actions have dedicated limits", adminAction.includes('"admin-catalog-sync"') && adminAction.includes('"admin-npc-tick"'));
check("Admin Stars refund is paid-only and marks after Bot API success",
  adminAction.includes('action === "stars.refund"')
  && adminAction.includes('telegramBotApi<boolean>("refundStarPayment"')
  && adminAction.indexOf('telegramBotApi<boolean>("refundStarPayment"') < adminAction.indexOf('status: "refunded"')
  && adminAction.includes('purchase.data.status !== "paid"')
  && adminAction.includes('mark_star_purchase_refunded_v200')
  && adminAction.includes("payer_telegram_id")
  && adminAction.includes("telegram_payment_charge_id")
);
check("Refund reconciliation queue is surfaced and audited",
  migration028.includes("reconcile_star_refund_v028")
  && migration028.includes("'virtualReversal','reconciled'")
  && migration028.includes("'automaticReversal',false")
  && adminOverview.includes("refundReconciliation")
  && adminOverview.includes("manual_review_required")
  && adminAction.includes('action === "stars.refund.reconcile"')
  && adminAction.includes('"stars.refund_reconciled"')
  && adminPage.includes("RefundReconciliationQueue")
  && adminPage.includes("автоматически не отзываются")
);
check("Gift market fee treasury", migration020.includes("MXM Treasury") && migration020.includes("gift_fee_bps"));

check("Telegram Gift download timeout", gifts.includes("AbortSignal.timeout(TELEGRAM_FILE_TIMEOUT_MS)"));
check("Telegram Gift file-size bound", gifts.includes("MAX_TELEGRAM_GIFT_FILE_BYTES") && gifts.includes("content-length"));
check("TGS decompression bound", gifts.includes("MAX_TGS_JSON_BYTES") && gifts.includes("maxOutputLength") && gifts.includes("readResponseBytesLimited"));
check("Binary media response bodies use exact ArrayBuffer bodies",
  httpBody.includes("toBodyArrayBuffer")
  && telegramAvatarRoute.includes("new NextResponse(toBodyArrayBuffer(bytes)")
  && giftMediaRoute.includes("new Response(toBodyArrayBuffer(limited)")
  && telegramFileRoute.includes("new NextResponse(toBodyArrayBuffer(bytes)")
  && telegramFileRoute.includes("readResponseBytesLimited(response, MAX_TELEGRAM_GIFT_FILE_BYTES)")
  && !telegramAvatarRoute.includes("new NextResponse(bytes,")
  && !giftMediaRoute.includes("new Response(limited,")
  && !telegramFileRoute.includes("new NextResponse(response.body")
);
check("Remote Gift media bodies are bounded before buffering",
  Boolean(httpBody)
  && giftMediaRoute.includes("readResponseBytesLimited")
  && giftMediaRoute.includes("MAX_ANIMATION_SOURCE_BYTES")
  && giftMediaRoute.includes("MAX_PREVIEW_BYTES")
);
check("Supabase TS2589 guard on large dynamic market queries",
  looseQuery.includes("LooseRowsQuery")
  && sweepRoute.includes("looseRowsQuery<SweepCandidate>")
  && marketSearchRoute.includes('looseRowsQuery<Record<string, unknown>>')
);

check("Gift resolver present", exists("lib/gifts/resolver.ts"));
check("TonAPI resilient client present", exists("lib/providers/tonapi-client.ts"));
check("Market health endpoint present", exists("app/api/system/market-health/route.ts"));
check("Atomic single-Gift purchase RPC present", migration017.includes("buy_virtual_gift_v2"));
check("Atomic cart purchase RPC present", migration017.includes("buy_virtual_gift_cart_v2"));
check("Fast session snapshot RPC", migration018.includes("session_profile_snapshot_v040") && auth.includes("getSessionProfileSnapshot"));

check("Public env does not expose service role", !/NEXT_PUBLIC_(?:SUPABASE_)?(?:SECRET|SERVICE_ROLE)/i.test(envTemplate));
const leaks = secretLeaks();
check("No probable literal secrets in artifact", leaks.length === 0, leaks.length ? leaks.slice(0, 5).join(", ") : "");

run("TypeScript", process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--incremental", "false"]);
run("ESLint", process.execPath, [path.join(root, "node_modules/eslint/bin/eslint.js"), "."]);

if (!process.env.TONAPI_KEY) notes.push("TONAPI_KEY не задан в shell: каталог перейдёт на публичный rate limit TonAPI.");
if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) notes.push("Supabase env не загружен в этой shell-сессии; проверьте production env перед deploy.");
if (!process.env.TELEGRAM_BOT_TOKEN) notes.push("TELEGRAM_BOT_TOKEN не загружен в этой shell-сессии.");
notes.push("npm audit требует доступ к registry.npmjs.org; если CI имеет сеть, запустите npm audit --omit=dev отдельно.");

if (notes.length) {
  console.log("\nNOTES");
  for (const note of notes) console.log(`- ${note}`);
}
console.log(`\n${failed ? "RELEASE BLOCKED" : "STATIC RELEASE CHECK PASSED"}`);
process.exit(failed ? 1 : 0);
