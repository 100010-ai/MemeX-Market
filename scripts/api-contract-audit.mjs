import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const apiRoot = path.join(root, "app", "api");
let failed = false;
let checks = 0;

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else if (entry.name === "route.ts") output.push(absolute);
  }
  return output;
}
function check(label, ok, detail = "") {
  checks += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

const routes = walk(apiRoot);
const missingWrapper = [];
const rawServerErrors = [];
const exportedHandlers = [];
for (const file of routes) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("withApiErrors(")) missingWrapper.push(relative);
  const methodMatches = [...text.matchAll(/export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=\s*([^;\n]+)/g)];
  for (const match of methodMatches) {
    exportedHandlers.push(`${relative}:${match[1]}`);
    if (!match[2].includes("withApiErrors(")) missingWrapper.push(`${relative}:${match[1]}`);
  }
  if (/NextResponse\.json\(\{\s*error\s*:\s*(?:error\.message|error\s+instanceof\s+Error\s*\?\s*error\.message|String\(error)/m.test(text)) rawServerErrors.push(relative);
}

check("API routes discovered", routes.length > 0, `${routes.length} files / ${exportedHandlers.length} handlers`);
check("All exported API handlers use withApiErrors", missingWrapper.length === 0, missingWrapper.slice(0, 8).join(", "));
check("No raw server/database errors are exposed", rawServerErrors.length === 0, rawServerErrors.slice(0, 8).join(", "));

const helper = fs.readFileSync(path.join(root, "lib", "api-route.ts"), "utf8");
check("API responses carry correlation IDs", helper.includes("x-mxm-request-id") && helper.includes("server-timing"));
check("Database schema errors use a stable code", helper.includes("DB_SCHEMA_OUTDATED") && helper.includes("isDatabaseSchemaError"));
check("Production error detail is hidden", helper.includes('process.env.NODE_ENV === "development" ? errorMessage(error) : undefined'));

console.log(`\n${failed ? "API CONTRACT AUDIT FAILED" : `API CONTRACT AUDIT PASSED (${checks} checks)`}`);
process.exit(failed ? 1 : 0);
