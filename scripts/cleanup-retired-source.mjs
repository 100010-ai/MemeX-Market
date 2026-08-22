import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const retiredPaths = [
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
  "ADSGRAM_MODERATION.md",
  "docs/ADS_REWARDED_SETUP_V045.md",
  "docs/ADMIN_MARKETING_V047.md",
];

let removed = 0;
for (const path of retiredPaths) {
  if (!existsSync(path)) continue;
  await rm(path, { recursive: true, force: true });
  console.log(`removed retired source: ${path}`);
  removed += 1;
}

console.log(removed ? `retired source cleanup complete (${removed})` : "retired source cleanup: nothing to remove");
