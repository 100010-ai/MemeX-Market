import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
let failed = false;

function exists(relative) {
  return fs.existsSync(path.join(root, relative));
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

const gamesPage = exists("app/games/page.tsx") ? fs.readFileSync(path.join(root, "app/games/page.tsx"), "utf8") : "";
check("Retired Games page cannot expose gameplay", !gamesPage || gamesPage.includes('redirect("/market")'));

console.log(`\n${failed ? "PREBUILD SOURCE GATE FAILED" : "PREBUILD SOURCE GATE PASSED"}`);
process.exit(failed ? 1 : 0);
