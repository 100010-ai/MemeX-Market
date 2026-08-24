import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));

const packageJson = JSON.parse(read("package.json"));
const appVersionSource = read("lib/app-version.ts");
const appVersionMatch = appVersionSource.match(/APP_VERSION\s*=\s*["']([^"']+)["']/);
const appVersion = appVersionMatch?.[1] || "";
const packageVersion = String(packageJson.version || "").trim();
const packageManager = String(packageJson.packageManager || "").trim();

const failures = [];

if (!packageVersion) failures.push("package.json has no version");
if (!appVersion) failures.push("lib/app-version.ts has no APP_VERSION literal");
if (packageVersion && appVersion && packageVersion !== appVersion) {
  failures.push(`version mismatch: package.json=${packageVersion}, APP_VERSION=${appVersion}`);
}

if (packageManager.startsWith("pnpm@")) {
  if (!exists("pnpm-lock.yaml")) failures.push("packageManager is pnpm but pnpm-lock.yaml is missing");
  if (exists("package-lock.json")) failures.push("packageManager is pnpm but stale package-lock.json is tracked");
}

if (failures.length) {
  console.error("MXM version check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`MXM version check passed: ${packageVersion} (${packageManager || "package manager not pinned"})`);
