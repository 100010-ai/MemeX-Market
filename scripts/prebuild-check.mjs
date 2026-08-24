import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
let failed = false;

function exists(relative) {
  return fs.existsSync(path.join(root, relative));
}

function read(relative) {
  return exists(relative) ? fs.readFileSync(path.join(root, relative), "utf8") : "";
}

function check(label, condition, detail = "") {
  const ok = Boolean(condition);
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

console.log("MXM prebuild source gate\n");

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
check("pnpm is the only package-manager lock", exists("pnpm-lock.yaml") && !exists("package-lock.json"));
check("pnpm package manager is pinned", /^pnpm@10\./.test(String(packageJson.packageManager || "")));
check("Verifier exists", exists("scripts/verify.mjs"));
check("Full release gate exists", exists("scripts/release-check.mjs"));

const retiredRuntimePaths = [
  "app/api/auth/dev",
  "app/api/games",
  "app/api/rewards/ads",
  "app/api/sponsored-tasks",
  "app/api/public/reward-confirmations",
  "app/reward-confirmations",
  "app/moderation",
  "lib/adsgram-url.ts",
  "lib/rewarded-ads.ts",
  "lib/sponsored-tasks.ts",
  "lib/feature-flags.ts",
  "scripts/adsgram-check.mjs",
];
const retiredStillPresent = retiredRuntimePaths.filter(exists);
check("Retired runtime source is absent", retiredStillPresent.length === 0, retiredStillPresent.join(", "));

const trackedDebugArtifacts = fs.readdirSync(root).filter((name) => /^\.codex-browser.*\.log$/i.test(name));
check("Browser debug logs are not in release tree", trackedDebugArtifacts.length === 0, trackedDebugArtifacts.join(", "));

const gamesPage = read("app/games/page.tsx");
check("Retired Games page cannot expose gameplay", !gamesPage || gamesPage.includes('redirect("/market")'));

const giftMediaRoute = read("app/api/gifts/media/[assetId]/route.ts");
check(
  "Gift previews recover from Fragment CDN misses",
  giftMediaRoute.includes("liveTonApiPreviewUrls")
    && giftMediaRoute.includes("chain_nft_address")
    && giftMediaRoute.includes("/v2/nfts/")
    && giftMediaRoute.includes("if (response) return response"),
);

const marketHealthRoute = read("app/api/system/market-health/route.ts");
check(
  "Operational market health is admin-only",
  marketHealthRoute.includes('requireAdminProfile')
    && !marketHealthRoute.includes('requireSession()')
    && !marketHealthRoute.includes('databaseErrors: errors.map'),
);

const cartRoute = read("app/api/cart/route.ts");
check(
  "Cart mutations reject unknown actions",
  cartRoute.includes('action !== "add" && action !== "remove" && action !== "clear"'),
);

const alertsRoute = read("app/api/alerts/route.ts");
check(
  "Alert mutations validate action and boolean state",
  alertsRoute.includes('const actions = new Set(["create", "delete", "toggle"])')
    && alertsRoute.includes('typeof body.enabled !== "boolean"'),
);

const watchlistRoute = read("app/api/watchlist/route.ts");
check(
  "Watchlist rejects ambiguous state and cleans stale items",
  watchlistRoute.includes('typeof body.enabled !== "boolean"')
    && watchlistRoute.includes('watchlist stale cleanup')
    && watchlistRoute.includes('cleanCoinIds.length + cleanCollections.length + cleanGiftIds.length'),
);

const notificationsRoute = read("app/api/system/notifications-dispatch/route.ts");
check(
  "Notification workers isolate item failures and protect sent claims",
  notificationsRoute.includes('price alert evaluation item failed')
    && notificationsRoute.includes('notification sent but completion state failed')
    && notificationsRoute.includes('.select("id")')
    && notificationsRoute.includes('alertFailures'),
);

const coinOrdersRoute = read("app/api/system/coin-orders/route.ts");
check(
  "System cron endpoints share hardened secret handling",
  coinOrdersRoute.includes('String(process.env.CRON_SECRET || "").trim()')
    && coinOrdersRoute.includes('x-mxm-cron-secret'),
);

console.log(`\n${failed ? "PREBUILD SOURCE GATE FAILED" : "PREBUILD SOURCE GATE PASSED"}`);
process.exit(failed ? 1 : 0);
