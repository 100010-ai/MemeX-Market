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
const migration99999 = read("supabase/migrations/99999_store_battlepass_cases_v13.sql");
const migration100022 = read("supabase/migrations/100022_memecoin_vip_launch_repair_v0661.sql");
const migration100023 = read("supabase/migrations/100023_memecoin_launch_fee_rebalance_v0662.sql");
const migration100024 = read("supabase/migrations/100024_admin_analytics_permissions_v0670.sql");
const migration100025 = read("supabase/migrations/100025_admin_funnel_consistency_v0671.sql");
const migration100026 = read("supabase/migrations/100026_system_hardening_v0700.sql");
const migration100027 = read("supabase/migrations/100027_remaining_fk_indexes_v0700.sql");
const migration100028 = read("supabase/migrations/100028_tonapi_content_media_v0700.sql");
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
const giftMediaComponent = read("components/gifts/gift-media.tsx");
const mappers = read("lib/mappers.ts");
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
check("Migration 9998 player UI copy cleanup present", exists("supabase/migrations/9998_ui_copy_polish.sql"));
check("Migration 99999 store/battle-pass/cases v0.63 present", Boolean(migration99999));
const migration100000 = read("supabase/migrations/100000_cases_runtime_hotfix_v13_1.sql");
check("Migration 100000 case runtime hotfix v0.63.1 present", Boolean(migration100000));
check("v0.70.0 package version", packageJson.includes('"version": "0.70.0"'));
const migration100003 = read("supabase/migrations/100003_orders_runtime_compat_v0648.sql");
check("Migration 100003 Orders runtime compatibility present", Boolean(migration100003));
check("Migration 100022 restores memecoin VIP launch dependency", migration100022.includes("create table if not exists public.vip_point_events") && migration100022.includes("credit_vip_activity_v200") && migration100022.includes("revoke execute"));
check("Migration 100023 makes the paid launch reachable", migration100023.includes("coin_launch_fee=50") && migration100023.includes("coin_launch_fee=150"));
check("Migration 100024 adds live product analytics and RBAC", migration100024.includes("profile_presence_v067") && migration100024.includes("admin_analytics_v067") && migration100024.includes("admin_members_v067") && migration100024.includes("revoke execute"));
check("Migration 100025 keeps conversion stages nested", migration100025.includes("admin_funnel_v067") && migration100025.includes("from active_new") && migration100025.includes("revoke execute"));
check("Migration 100026 repairs media and hardens Data API", migration100026.includes("consume_rate_limits_v070") && migration100026.includes("model_is_animated = n.is_animated") && migration100026.includes("alter default privileges"));
check("Migration 100027 completes FK coverage", migration100027.includes("season_claims_reward_fk_idx") && migration100027.includes("user_missions_mission_id_fk_idx"));
check("Migration 100028 preserves trusted TonAPI content", migration100028.includes("content_url") && migration100028.includes("headgun\\.org") && migration100028.includes("chat-mafia\\.com"));
check("v0.67 admin dashboard uses real charts and periods", exists("components/admin/admin-dashboard.tsx") && read("components/admin/admin-trend-chart.tsx").includes("lightweight-charts") && adminPage.includes("AdminDashboard") && adminPage.includes("AdminTeamPanel"));
check("v0.67 admin permissions guard operations", read("lib/admin.ts").includes("ADMIN_ROLE_PERMISSIONS") && adminAction.includes("permissionForAction") && adminAction.includes('action === "admin.member.upsert"'));
check("v0.67 presence is authenticated and rate-limited", read("app/api/analytics/presence/route.ts").includes("requireProfile") && read("app/api/analytics/presence/route.ts").includes("sameOriginMutation") && read("app/api/analytics/presence/route.ts").includes("enforceRateLimit"));
check("v0.68 launch studio exposes real readiness and budget", createPage.includes("mxm-launch-studio") && createPage.includes("launchBudget") && createPage.includes("LaunchCheck") && createPage.includes("economyReady"));
check("v0.68 trade ticket exposes recovery and minimum received", read("app/coin/[id]/page.tsx").includes("mxm-coin-load-error") && read("app/coin/[id]/page.tsx").includes("Мин. к получению") && read("app/coin/[id]/page.tsx").includes("Серверная котировка"));
check("v0.68 portfolio has search-aware empty states", read("app/vault/page.tsx").includes("activeGiftRows.length") && read("app/vault/page.tsx").includes("sortedHoldings.length") && read("app/vault/page.tsx").includes("messageTone"));
check("v0.68 operations center summarizes live exposure", read("app/orders/page.tsx").includes("mxm-orders-summary") && read("app/orders/page.tsx").includes("incomingValue") && read("app/orders/page.tsx").includes("listingValue"));
check("v0.68 home exposes commercial command center", read("app/hub/page.tsx").includes("mxm-home-command") && read("app/hub/page.tsx").includes("Новый мемкоин") && read("app/hub/page.tsx").includes("availableBalance"));
check("v0.69 cart keeps an authoritative purchase receipt", read("app/cart/page.tsx").includes("CheckoutReceipt") && read("app/cart/page.tsx").includes("Promise.allSettled") && read("app/cart/page.tsx").includes("Покупка завершена"));
check("v0.69 gift purchase refresh cannot mask a completed mutation", read("components/gifts/gift-detail.tsx").includes("Promise.allSettled([load(), refreshProfile()])") && read("components/gifts/gift-detail.tsx").includes("Подарок куплен"));
check("v0.69 collection sweep uses in-app confirmation", read("app/collections/[name]/page.tsx").includes("sweepArmed") && !read("app/collections/[name]/page.tsx").includes("window.confirm"));
check("v0.69 collection offers expose reserve and execution state", read("components/gifts/advanced-offers-panel.tsx").includes("estimatedReserve") && read("components/gifts/advanced-offers-panel.tsx").includes("activeReserve") && read("components/gifts/advanced-offers-panel.tsx").includes("Исполнение и резерв контролирует сервер"));
check("v0.69 commercial Gift cards surface listing trust", read("components/gifts/gift-card.tsx").includes("mxm-gift-cover-state") && read("components/gifts/gift-card.tsx").includes("TON"));
check("v0.69.1 Gift previews never pass animation files to img", giftMediaComponent.includes("staticImageSource") && giftMediaComponent.includes('gift.mediaKind === "static"') && mappers.includes("safeImageMediaUrl") && mappers.includes("modelIsStatic ? telegramFileUrl(row.model_file_id)"));
check("v0.69.1 Gift preview failures advance through real sources", giftMediaComponent.includes("previewAttempt") && giftMediaComponent.includes("previewSources[previewIndex]") && giftMediaComponent.includes("Медиа недоступно"));
check("v0.69.1 media proxy isolates provider timeouts", giftMediaRoute.includes("requestSignal.addEventListener") && giftMediaRoute.includes("1_800") && giftMediaRoute.includes("gift media sources exhausted"));
check("v0.70 NFT importer trusts observed media kind", !read("lib/tonapi-gifts.ts").includes('mediaKind: fragmentMedia ? "animated"') && read("lib/tonapi-gifts.ts").includes("TonAPI actually returned"));
check("v0.70 media proxy prefers persisted metadata", giftMediaRoute.includes("chain_metadata") && giftMediaRoute.includes("metadataPreview") && giftMediaRoute.includes(".getgems.io"));
check("v0.70 app readiness is not blocked by whole-app API warming", !read("components/telegram-provider.tsx").includes("criticalRequests") && read("components/telegram-provider.tsx").includes("setAppReady(true)") && !read("components/telegram-provider.tsx").includes("secondaryRoutes"));
check("v0.70 trade retries preserve their idempotent contract", read("app/coin/[id]/page.tsx").includes("pendingTradeIntent") && read("app/coin/[id]/page.tsx").includes("minOutput: intent.minOutput"));
check("v0.70 rate limits use one atomic RPC", read("lib/security.ts").includes('rpc("consume_rate_limits_v070"') && read("lib/security.ts").includes("p_keys"));
check("v0.70 security headers cover Telegram-safe framing and transport", read("next.config.ts").includes("Strict-Transport-Security") && read("next.config.ts").includes("frame-ancestors 'self' https://web.telegram.org https://*.telegram.org"));
check("v0.70 compact visual system is present", read("app/globals.css").includes("v0.70 — compact commercial system") && read("app/globals.css").includes("contain-intrinsic-size"));
check("v0.64.8 Orders tolerates missing seller denormalization",
  read("app/api/orders/route.ts").includes("isMissingSellerProfileColumn")
  && read("app/api/orders/route.ts").includes("virtual_gifts!inner(owner_profile_id)")
  && read("app/orders/page.tsx").includes("sellerScopedOffers")
  && migration100003.includes("add column if not exists seller_profile_id")
  && migration100003.includes("notify pgrst, 'reload schema'")
);
check("v0.63.1 case RPC is self-healing", migration100000.includes("create or replace function public.open_case_v200") && migration100000.includes("decode(replace(gen_random_uuid()::text") && migration100000.includes("notify pgrst, 'reload schema'"));
check("v0.63.1 case errors are observable", read("app/api/cases/route.ts").includes("[cases:open]") && read("app/api/cases/route.ts").includes("schemaMismatch"));
check("v0.63.1 keeps retired games disabled", !migration100000.includes("play_virtual_game"));
const migration100001 = read("supabase/migrations/100001_progression_update_v064.sql");
check("Migration 100001 progression v0.64 present", Boolean(migration100001));
check("v0.64 progression primitives present", migration100001.includes("account_level") && migration100001.includes("daily_streak") && migration100001.includes("achievement") && migration100001.includes("collection"));

// v0.64.2 Existing Systems Polish: every existing player/admin surface touched by the pass.
check("v0.64.2 cases roulette can skip safely", read("app/cases/page.tsx").includes("skipReveal") && read("app/cases/page.tsx").includes("Пропустить") && read("app/cases/page.tsx").includes("pendingRevealRef"));
check("v0.64.2 battle pass uses compact horizontal track", read("app/season/page.tsx").includes("mxm-season-track") && read("app/season/page.tsx").includes("scrollIntoView") && read("app/season/page.tsx").includes("claimAll"));
check("v0.64.2 store explains unavailable actions", read("components/store-front.tsx").includes("actionReason") && read("components/store-front.tsx").includes("pendingStarsProduct") && read("components/store-front.tsx").includes("confirmPurchaseConsent"));
check("v0.64.2 profile frames use shaped silhouettes", read("components/profile-avatar.tsx").includes("mxm-profile-frame-orbit-dot") && read("app/globals.css").includes("mxm-profile-frame-prestige") && read("app/globals.css").includes("clip-path: polygon"));
check("v0.64.2 profile has achievement showcase", read("app/profile/page.tsx").includes("Витрина достижений") && read("app/profile/page.tsx").includes("mxm-profile-achievement"));
check("v0.64.2 achievements are filterable", read("app/progression/page.tsx").includes("achievementFilter") && read("app/progression/page.tsx").includes("mxm-filter-chip"));
check("v0.64.2 daily streak remains server-backed", read("app/progression/page.tsx").includes("claim_streak") || read("app/api/progression/route.ts").includes("streak"));
check("v0.64.2 collection book links missing items to market", read("app/collections/page.tsx").includes("Найти на рынке") && read("app/collections/page.tsx").includes("milestoneOptions"));
check("v0.64.2 market restores UI state", read("app/market/page.tsx").includes("MARKET_UI_STATE_KEY") && read("app/market/page.tsx").includes("scrollY") && read("app/market/page.tsx").includes("sessionStorage"));
check("v0.64.2 memecoin trade has confirmed-state notice", read("app/coin/[id]/page.tsx").includes("tradeNotice") && read("app/coin/[id]/page.tsx").includes("data.coin.symbol"));
check("v0.64.2 tasks support claim-all + live refresh", read("app/tasks/page.tsx").includes("async function claimAll") && read("app/tasks/page.tsx").includes("visibilitychange"));
check("v0.64.2 leaderboard renders frames + own rank", read("app/leaderboard/page.tsx").includes("ProfileAvatar") && read("app/leaderboard/page.tsx").includes("Ваша позиция"));
check("v0.64.2 portfolio persists tabs and sorting", read("app/vault/page.tsx").includes("giftSort") && read("app/vault/page.tsx").includes("sessionStorage"));
check("v0.64.2 notifications prevent duplicate interaction", read("app/notifications/page.tsx").includes("mxm-switch") && read("app/notifications/page.tsx").includes("busy === `pref:${key}`"));
check("v0.64.2 creator tools expose active entitlements", read("app/creator/page.tsx").includes("Активные инструменты") && read("app/creator/page.tsx").includes("expiresAt"));
check("v0.64.2 control mutations are guarded", read("app/control/page.tsx").includes("CONTROL_ACTION_LABELS") && read("app/control/page.tsx").includes("window.confirm") && read("app/control/page.tsx").includes("if(busy)return"));
check("v0.64.2 fixed header + stable native controls", read("components/app-shell.tsx").includes("mxm-topbar-fixed") && read("app/globals.css").includes("input[type=\"checkbox\"]") && read("app/globals.css").includes("-webkit-tap-highlight-color: transparent"));


// v0.64.4 Memecoin Market Polish: neutral launch state + one-screen mobile terminal.
const migration100002 = read("supabase/migrations/100002_memecoin_market_polish_v0644.sql");
check("Migration 100002 memecoin polish v0.64.4 present", Boolean(migration100002));
check("v0.64.4 launch seed is excluded from public market stats", migration100002.includes("is_launch_seed") && migration100002.includes("where is_launch_seed=false") && migration100002.includes("market_open_price"));
check("v0.64.4 coin page is one-screen on mobile", read("app/coin/[id]/page.tsx").includes("mxm-coin-screen") && read("app/globals.css").includes("var(--mxm-viewport-height)") && read("app/globals.css").includes("overflow: hidden"));
check("v0.64.4 memecoin metrics moved out of main flow", read("app/coin/[id]/page.tsx").includes("MetricsSheet") && read("app/coin/[id]/page.tsx").includes("setMetricsOpen(true)"));
check("v0.64.4 launch bootstrap is hidden from feed/history", read("lib/feed.ts").includes('eq("is_launch_seed", false)') && read("app/api/portfolio/route.ts").includes('eq("is_launch_seed", false)') && read("app/api/coins/[id]/route.ts").includes('eq("is_launch_seed", false)'));
check("v0.64.4 chart has compact small-price formatting", read("components/coin-chart.tsx").includes("axisPrice") && read("components/coin-chart.tsx").includes("emptyLabel") && read("components/coin-chart.tsx").includes("compact = false"));

// v0.64.5 Release Polish: existing surfaces + build/Telegram hardening.
check("v0.64.5 dashboard is actionable", read("app/hub/page.tsx").includes("/api/season") && read("app/hub/page.tsx").includes("/api/tasks") && read("app/page.tsx").includes('redirect("/hub")'));
check("v0.64.5 gift details keep secondary market data collapsible", read("components/gifts/gift-detail.tsx").includes("mxm-gift-market-details") && read("components/gifts/gift-detail.tsx").includes("Подтвердить"));
check("v0.64.5 market restores explicit deep links safely", read("app/market/page.tsx").includes("hasExplicitMarketState") && read("app/market/page.tsx").includes("AbortController"));
check("v0.64.5 portfolio sorting persists", read("app/vault/page.tsx").includes("mxm-vault-gift-sort") && read("app/vault/page.tsx").includes("mxm-vault-coin-sort"));
check("v0.64.5 case result has rarity-aware feedback", read("app/cases/page.tsx").includes("Награда зачислена") && read("app/cases/page.tsx").includes('rarity === "legendary"'));
check("v0.64.5 memecoin high-impact trade needs confirmation", read("app/coin/[id]/page.tsx").includes("impactArmed") && read("app/coin/[id]/page.tsx").includes("Подтвердить сделку"));
check("v0.64.5 task claim-all is server batched", read("app/api/tasks/claim/route.ts").includes('action === "claim_all"') && read("app/tasks/page.tsx").includes('action: "claim_all"'));
check("v0.64.5 notifications de-duplicate exact rows", read("app/api/notifications/route.ts").includes("const seen = new Map<string, number>()"));
check("v0.64.5 Telegram warmup adapts to weak devices", read("components/telegram-provider.tsx").includes("getClientPerformanceProfile") && read("lib/client-performance.ts").includes("deviceMemory"));
check("v0.64.5 Telegram keyboard avoids bottom-nav overlap", read("components/telegram-provider.tsx").includes("mxm-keyboard-open") && read("app/globals.css").includes(".mxm-keyboard-open .mxm-bottom-nav"));
check("v0.64.5 shell renders equipped frames consistently", read("components/app-shell.tsx").includes("<ProfileAvatar") && read("components/app-shell.tsx").includes("equippedFrame"));
check("v0.64.5 dashboard coin query uses compact payload", read("app/hub/page.tsx").includes("compact=1") && read("app/api/market/route.ts").includes('const compact = request.nextUrl.searchParams.get("compact") === "1"'));
check("v0.64.5 portfolio has compact market handoff", read("app/vault/page.tsx").includes("mxm-portfolio-quick") && read("app/vault/page.tsx").includes('href="/market"'));
check("v0.64.5 control audit records before/after", read("app/api/control/action/route.ts").includes('before: { balance:') && read("app/api/control/action/route.ts").includes('after: { ...before.data, ...patch }'));
check("v0.64.5 one-command verifier present", exists("scripts/verify.mjs") && packageJson.includes('"verify": "node scripts/verify.mjs"') && packageJson.includes('"verify:static"'));

// v0.64.6 Telegram 6.0 compatibility + Control request hardening.
check("v0.64.6 Telegram protocol methods are version-gated", read("components/telegram-provider.tsx").includes('telegramSupports(webApp, "backButton")') && read("components/telegram-provider.tsx").includes('telegramSupports(webApp, "safeArea")') && read("lib/telegram-webapp.ts").includes("FEATURE_MIN_VERSION"));
check("v0.64.6 Stars invoice is version-gated", read("components/store-front.tsx").includes('telegramSupports(webApp, "invoice")') && read("components/store-front.tsx").includes("Обнови Telegram"));
check("v0.64.6 Control validates payload before POST", read("app/control/page.tsx").includes("controlPayloadError") && read("app/control/page.tsx").includes("validPrice"));
check("v0.64.6 Control server separates validation from runtime failures", read("app/api/control/action/route.ts").includes("isDatabaseSchemaError") && read("app/api/control/action/route.ts").includes("CONTROL_FAILED") && read("app/api/control/action/route.ts").includes("CONTROL_CONFLICT"));

// v0.64.7 Economy & Performance Polish: all 16 requested existing-system passes.
check("v0.64.7 economy input is normalized centrally", economy.includes("parseEconomyAmount") && economy.includes("MAX_COIN_TRADE_INPUT") && read("app/api/trade/route.ts").includes("MIN_COIN_BUY_TON"));
check("v0.64.7 AMM preview uses configured fee", read("lib/amm.ts").includes("feeRate?: number") && read("app/coin/[id]/page.tsx").includes("data.economy.totalFeeBps") && read("app/api/coins/[id]/quote/route.ts").includes("quote_coin_trade_v202"));
check("v0.64.7 memecoin trade boundaries are hardened", read("app/api/coins/[id]/quote/route.ts").includes("MAX_COIN_TRADE_INPUT") && read("app/api/coins/[id]/orders/route.ts").includes("MIN_COIN_BUY_TON") && read("app/coin/[id]/page.tsx").includes("nextTokenReserve <= 0"));
check("v0.64.7 gift market paging adapts to constrained networks", marketPage.includes("constrainedNetwork") && marketPage.includes('"72px 0px"'));
check("v0.64.7 stale gift purchase conflicts refresh authoritatively", read("components/gifts/gift-detail.tsx").includes('key === "buy"') && read("app/api/gifts/[id]/buy/route.ts").includes("GIFT_CONFLICT"));
check("v0.64.7 gift details expose compact market handoff", read("components/gifts/gift-detail.tsx").includes("Похожие лоты") && read("components/gifts/gift-detail.tsx").includes('replace(",", ".")'));
check("v0.64.7 portfolio first payload is bounded and searchable", read("app/api/portfolio/route.ts").includes("DEFAULT_GIFT_PAGE_SIZE = 96") && read("app/vault/page.tsx").includes("assetQuery") && read("app/globals.css").includes(".mxm-vault-search"));
check("v0.64.7 case reel is rarity paced and series-aware", read("app/cases/page.tsx").includes("revealMs") && read("app/cases/page.tsx").includes("data-case-series") && read("app/globals.css").includes('data-case-series="case_vault"'));
check("v0.64.7 battle pass refreshes global wallet after claims", read("app/season/page.tsx").includes("refreshProfile") && read("app/season/page.tsx").includes("Promise.all([load(), refreshProfile()])"));
check("v0.64.7 profile hierarchy keeps identity private and dense", read("app/profile/page.tsx").includes('size="large"') && read("app/profile/page.tsx").includes("Профиль Telegram") && read("app/profile/page.tsx").includes("LVL {profile.level}"));
check("v0.64.7 frames degrade cleanly on constrained devices", read("components/telegram-provider.tsx").includes("mxm-device-constrained") && read("app/globals.css").includes(".mxm-device-constrained .mxm-profile-frame-orbit-dot"));
check("v0.64.7 progression refresh is de-bounced and notices self-clear", tasks.includes("lastRefreshAt") && tasks.includes("setTimeout(() => setNotice(null), 3600") && read("app/progression/page.tsx").includes("lastRefreshAt"));
check("v0.64.7 leaderboard handles tied podium ranks without duplicate rows", read("app/leaderboard/page.tsx").includes("player.rank <= 3") && read("app/leaderboard/page.tsx").includes("player.rank > 3"));
check("v0.64.7 notifications de-duplicate before badge count", notificationsApi.includes("const seen = new Map<string, number>()") && notificationsApi.includes("normalized.reduce"));
check("v0.64.7 store CTA surfaces owned/unavailable state", read("components/store-front.tsx").includes("actionReason") && read("components/store-front.tsx").includes("highlights.slice(0, 2)"));
check("v0.64.7 creator analytics stays quiet for pristine markets", read("app/creator/page.tsx").includes("hasMarketActivity") && read("app/creator/page.tsx").includes("Новый рынок"));
check("v0.64.7 control caps economy mutations on client and server", read("app/control/page.tsx").includes("CONTROL_MAX_BALANCE") && read("app/api/control/action/route.ts").includes("CONTROL_MAX_BALANCE") && read("app/control/page.tsx").includes('aria-live="polite"'));
check("v0.64.7 Telegram/mobile performance mode is surfaced to CSS", read("components/telegram-provider.tsx").includes('classList.toggle("mxm-device-constrained"') && read("app/globals.css").includes("overscroll-behavior-y:contain"));


// v0.64.9 Stability & Visual Consistency: final 20-point production polish.
check("v0.64.9 UI primitives are unified", read("components/ui.tsx").includes("mxm-surface-block") && read("components/ui.tsx").includes("InlineNotice") && read("app/globals.css").includes(".mxm-pressable"));
check("v0.64.9 motion respects constrained and reduced-motion clients", read("lib/client-performance.ts").includes("shouldUseRichMotion") && read("app/globals.css").includes("prefers-reduced-motion"));
check("v0.64.9 Gift Market uses adaptive page sizing", read("app/market/page.tsx").includes("adaptiveListPageSize") && read("app/market/page.tsx").includes("rootMargin"));
check("v0.64.9 Gift detail prioritizes trading", read("components/gifts/gift-detail.tsx").includes("mxm-gift-trade-panel") && read("app/globals.css").includes("position:sticky"));
check("v0.64.9 memecoin chart starts from the first public candle", read("app/coin/[id]/page.tsx").includes("chartCandles.length >= 1") && read("app/coin/[id]/page.tsx").includes("openTelegramLinkSafely"));
check("v0.64.9 portfolio supports adaptive rendering and quick sell", read("app/vault/page.tsx").includes("adaptiveListPageSize") && read("app/vault/page.tsx").includes("mxm-vault-quick-sell"));
check("v0.64.9 battle pass has focused track and live success state", read("app/season/page.tsx").includes("mxm-season-track") && read("app/season/page.tsx").includes("mxm-success-pop"));
check("v0.64.9 cases reduce roulette work on constrained devices", read("app/cases/page.tsx").includes("getClientPerformanceProfile") && read("app/cases/page.tsx").includes("constrained"));
check("v0.64.9 profile keeps secondary metrics collapsed", read("app/profile/page.tsx").includes("mxm-profile-more") && read("app/profile/page.tsx").includes("Активы"));
check("v0.64.9 frames simplify small and constrained renders", read("app/globals.css").includes('[data-profile-frame-size="small"] .mxm-profile-frame-mark') && read("app/globals.css").includes(".mxm-device-constrained .mxm-profile-frame-mark"));
check("v0.64.9 progression feedback is live and compact", read("app/progression/page.tsx").includes("mxm-success-pop") && read("app/tasks/page.tsx").includes("mxm-success-pop"));
check("v0.64.9 leaderboard rows use consistent interaction styling", read("app/leaderboard/page.tsx").includes("mxm-row-interactive") && read("app/leaderboard/page.tsx").includes("player.rank > 3"));
check("v0.64.9 notifications group by day", read("app/notifications/page.tsx").includes("Сегодня") && read("app/notifications/page.tsx").includes("Вчера"));
check("v0.64.9 store keeps unavailable CTA short with reason nearby", read("components/store-front.tsx").includes('unavailable ? "Недоступно"') && read("components/store-front.tsx").includes("actionReason"));
check("v0.64.9 control surfaces schema health", read("app/control/page.tsx").includes("SchemaHealthStrip") && read("app/api/control/bootstrap/route.ts").includes("inspectSchemaHealth"));
check("v0.64.9 Telegram feature matrix gates protocol calls", read("lib/telegram-webapp.ts").includes("FEATURE_MIN_VERSION") && read("lib/telegram-webapp.ts").includes("openTelegramLinkSafely") && read("components/telegram-provider.tsx").includes("telegramCapabilitySnapshot"));
check("v0.64.9 Telegram links use the compatibility helper", read("app/referrals/page.tsx").includes("openTelegramLinkSafely(url)") && read("app/tasks/page.tsx").includes("openTelegramLinkSafely(url)") && read("app/coin/[id]/page.tsx").includes("openTelegramLinkSafely(shareUrl)"));
check("v0.64.9 API contract auditor is part of verify", exists("scripts/api-contract-audit.mjs") && read("scripts/verify.mjs").includes("api-contract-audit.mjs"));
check("v0.64.9 schema health RPC and fallback probes exist", exists("lib/schema-health.ts") && exists("supabase/migrations/100004_schema_health_v0649.sql") && read("supabase/migrations/100004_schema_health_v0649.sql").includes("mxm_schema_health_v0649"));
check("v0.64.9 realtime has bounded polling fallback", read("components/realtime-refresh.tsx").includes("CHANNEL_ERROR") && read("components/realtime-refresh.tsx").includes("fallbackPolls") && read("components/realtime-refresh.tsx").includes("15_000"));
check("v0.64.9 request observability is correlated", read("lib/api-route.ts").includes("x-mxm-request-id") && read("lib/api-route.ts").includes("server-timing") && read("app/api/health/route.ts").includes("APP_VERSION"));

// v0.64.3 UX & Quality: quieter hierarchy, stronger mobile states, same mechanics.
check("v0.64.3 market has removable active filters", read("app/market/page.tsx").includes("mxm-active-filters") && read("app/market/page.tsx").includes("setCollection(\"all\")") && read("app/market/page.tsx").includes("setPriceBand(\"all\")"));
check("v0.64.3 gift and coin trade panels are visually unified", read("components/gifts/gift-detail.tsx").includes("mxm-gift-trade-panel") && read("app/coin/[id]/page.tsx").includes("mxm-trade-panel") && read("app/globals.css").includes(".mxm-gift-trade-panel"));
check("v0.64.3 cases keep authoritative roulette with quieter stage", read("app/cases/page.tsx").includes("mxm-case-stage-compact") && read("app/cases/page.tsx").includes("pendingRevealRef") && !read("app/cases/page.tsx").includes("Результат уже зафиксирован сервером"));
check("v0.64.3 battle pass XP sources are compact chips", read("app/season/page.tsx").includes("mxm-xp-chip") && read("app/globals.css").includes(".mxm-xp-chip"));
check("v0.64.3 tasks keep copy compact", read("app/tasks/page.tsx").includes("line-clamp-1") && read("app/tasks/page.tsx").includes("В процессе"));
check("v0.64.3 notifications clamp long bodies", read("app/notifications/page.tsx").includes("line-clamp-2") && read("app/notifications/page.tsx").includes("mxm-switch"));
check("v0.64.3 creator dashboard is compact", read("app/creator/page.tsx").includes("mxm-compact-page-head") && read("app/creator/page.tsx").includes("Выбрать инструменты"));
check("v0.64.3 control audit payloads are collapsed", read("app/control/page.tsx").includes("control-audit-details") && read("app/control/page.tsx").includes("<details"));
check("v0.64.3 production error UI hides raw backend details", read("app/error.tsx").includes('process.env.NODE_ENV !== "production"') && read("app/error.tsx").includes("error.message"));
check("v0.64.3 long grids use content visibility", read("app/globals.css").includes("content-visibility: auto") && read("app/globals.css").includes("contain-intrinsic-size"));
check("v0.64.3 frames keep shaped silhouettes", read("app/globals.css").includes('[data-profile-frame="carbon_frame"] .mxm-profile-frame-mark') && read("app/globals.css").includes("clip-path: polygon"));
check("v0.64.3 gift listing after-task resolves void", read("app/api/gifts/[id]/list/route.ts").includes("after(async () =>") && read("app/api/gifts/[id]/list/route.ts").includes("await evaluatePlayerMarketHandoff(false)"));
check("pnpm package manager pinned", packageJson.includes('"packageManager": "pnpm@') && exists("pnpm-lock.yaml") && !exists("package-lock.json"));
check("v0.63 expanded store catalogue", migration99999.includes("profile_founder_frame") && migration99999.includes("case_vault") && migration99999.includes("mxm_treasury"));
check("v0.63 real profile-frame renderer", exists("lib/profile-frames.ts") && read("components/profile-avatar.tsx").includes("getProfileFrameClass") && read("app/globals.css").includes("mxm-profile-frame-founder"));
check("v0.63 battle pass has claim-all", migration99999.includes("claim_all_season_rewards_v300") && read("app/api/season/route.ts").includes('action === "claim_all"') && read("app/season/page.tsx").includes("claimAll"));
check("v0.63 Stars CTA is not consent-disabled", read("components/store-front.tsx").includes("startStarsPurchase") && read("components/store-front.tsx").includes("pendingStarsProduct") && !read("components/store-front.tsx").includes("!termsAccepted || Boolean(unavailable)"));

check("v0.63 abandoned pending Stars invoices expire", migration99999.includes("expiredPending") && migration99999.includes("status='pending'"));
check("v0.63 route titles cover commerce screens", read("components/app-shell.tsx").includes('["/season", "Боевой пропуск"]') && read("components/app-shell.tsx").includes('["/cases", "Кейсы MXM"]') && read("components/app-shell.tsx").includes('["/creator", "Инструменты автора"]'));
check("v0.63 case stock is live", read("app/api/store/route.ts").includes("Limited case supply is mutable inventory") && !read("app/api/store/route.ts").includes("cases: (caseDefinitionsResult.data"));

check("Runtime config schema", migration026.includes("create table if not exists public.runtime_config_v056") && exists("lib/runtime-config.ts") && exists("app/api/runtime-config/route.ts"));
check("Maintenance mode + feature flags", read("components/app-shell.tsx").includes("maintenanceMode") && read("app/api/admin/runtime-config/route.ts").includes("validateRuntimeConfigInput"));
check("Advanced Gift offers", migration026.includes("advanced_gift_offers_v056") && migration026.includes("create_advanced_gift_offer_v056") && migration026.includes("accept_advanced_gift_offer_v056") && exists("components/gifts/advanced-offers-panel.tsx"));
check("Conditional memecoin orders", migration026.includes("coin_conditional_orders_v056") && exists("components/coin-conditional-orders.tsx") && exists("app/api/system/coin-orders/route.ts"));
check("Command palette", exists("components/command-palette.tsx") && /<(?:Deferred)?CommandPalette\b/.test(read("components/app-shell.tsx")));
check("Player market collection cards use Russian product copy",
  marketPage.includes("самых дешёвых")
  && marketPage.includes("Лента пока пуста")
  && !marketPage.includes(">Feed<")
  && !marketPage.includes("3 cheapest")
);
check("Task cards use responsive SVG-only actions",
  tasks.includes("mxm-task-card")
  && tasks.includes("Подписка на официальный канал")
  && !/[\u{1F300}-\u{1FAFF}]/u.test(tasks)
  && read("app/globals.css").includes(".mxm-task-actions { flex-wrap:wrap; }")
);
check("Public UI debug overlay is disabled in production",
  read("components/dev/perf-overlay.tsx").includes('process.env.NODE_ENV === "production"')
);
check("Admin Economy & Risk", exists("app/admin/economy-risk/page.tsx") && exists("app/api/admin/economy-risk/route.ts"));
check("Admin Health Center", exists("app/admin/health/page.tsx") && exists("app/api/admin/health/route.ts"));
check("Error Inbox infrastructure", exists("lib/error-inbox.ts") && migration026.includes("error_inbox_v056"));

check("Environment template present", Boolean(envTemplate));
check("Human support username documented",
  /^SUPPORT_TELEGRAM_USERNAME=/m.test(envTemplate)
  && read("README.md").includes("SUPPORT_TELEGRAM_USERNAME")
  && read("README.md").includes("human support account")
);
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
check("Current launch economics", economy.includes("COIN_LAUNCH_FEE_TON = 50") && economy.includes("COIN_MAX_ACTIVE_PER_CREATOR = 2") && economy.includes("COIN_LAUNCH_COOLDOWN_HOURS = 12"));
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
  .filter((relative) => !["scripts/release-check.mjs", "scripts/prebuild-check.mjs", "scripts/cleanup-retired-source.mjs"].includes(relative))
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
  && read("app/api/cart/route.ts").includes("Стартовая ликвидность отключена")
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
  && giftMediaRoute.includes("new Response(toBodyArrayBuffer(upstream.bytes)")
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

if (process.env.MXM_RELEASE_STATIC === "1") {
  notes.push("Dependency-backed TypeScript/ESLint intentionally skipped by static verification.");
} else {
  run("TypeScript", process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--incremental", "false"]);
  run("ESLint", process.execPath, [path.join(root, "node_modules/eslint/bin/eslint.js"), "."]);
}

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
