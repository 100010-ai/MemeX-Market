import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const staticOnly = process.argv.includes("--static");
let failed = false;

function result(label, ok, detail = "") {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}
function run(label, command, args, env = process.env) {
  const child = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false, env });
  result(label, child.status === 0, child.status == null ? "не удалось запустить" : `exit ${child.status}`);
  return child.status === 0;
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
function resolveImport(fromFile, specifier) {
  let base;
  if (specifier.startsWith("@/")) base = path.join(root, specifier.slice(2));
  else if (specifier.startsWith("./") || specifier.startsWith("../")) base = path.resolve(path.dirname(fromFile), specifier);
  else return true;
  const clean = base.split("?")[0].split("#")[0];
  const candidates = [clean, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css"].map((ext) => `${clean}${ext}`), ...[".ts", ".tsx", ".js", ".jsx"].map((ext) => path.join(clean, `index${ext}`))];
  return candidates.some((candidate) => fs.existsSync(candidate));
}
function loadTypeScript() {
  const local = path.join(root, "node_modules", "typescript", "lib", "typescript.js");
  if (fs.existsSync(local)) return createRequire(import.meta.url)(local);
  const npmRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8", shell: false });
  if (npmRoot.status === 0) {
    const globalTs = path.join(npmRoot.stdout.trim(), "typescript", "lib", "typescript.js");
    if (fs.existsSync(globalTs)) return createRequire(import.meta.url)(globalTs);
  }
  return null;
}

console.log(`MXM verify${staticOnly ? " (static)" : ""}\n`);
run("Retired-source cleanup", process.execPath, [path.join(root, "scripts/cleanup-retired-source.mjs")]);

const sourceFiles = walk(root).filter((file) => /\.(?:ts|tsx)$/.test(file));
const ts = loadTypeScript();
if (!ts) {
  result("TS/TSX parser", false, "TypeScript compiler API unavailable");
} else {
  const diagnostics = [];
  for (const file of sourceFiles) {
    const text = fs.readFileSync(file, "utf8");
    const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    for (const diagnostic of parsed.parseDiagnostics) diagnostics.push(`${path.relative(root, file)}:${diagnostic.start ?? 0} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  }
  result("TS/TSX parser", diagnostics.length === 0, `${sourceFiles.length} files${diagnostics.length ? `; ${diagnostics.slice(0, 4).join(" | ")}` : ""}`);
}

const importFailures = [];
const importPattern = /(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf8");
  let match;
  while ((match = importPattern.exec(text))) {
    if (!resolveImport(file, match[1])) importFailures.push(`${path.relative(root, file)} -> ${match[1]}`);
  }
}
result("Local import scan", importFailures.length === 0, `${sourceFiles.length} source files${importFailures.length ? `; ${importFailures.slice(0, 5).join(", ")}` : ""}`);

const cssFiles = walk(path.join(root, "app")).filter((file) => file.endsWith(".css"));
let open = 0; let close = 0;
for (const file of cssFiles) {
  const text = fs.readFileSync(file, "utf8");
  open += (text.match(/{/g) || []).length;
  close += (text.match(/}/g) || []).length;
}
result("CSS brace balance", open === close, `${open} open / ${close} close`);

run("API contract audit", process.execPath, [path.join(root, "scripts/api-contract-audit.mjs")]);
run("Release product/security gate", process.execPath, [path.join(root, "scripts/release-check.mjs")], staticOnly ? { ...process.env, MXM_RELEASE_STATIC: "1" } : process.env);

if (!staticOnly) {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) result("Next production build", false, "node_modules/next unavailable; install dependencies first");
  else run("Next production build", process.execPath, [nextBin, "build"]);
}

console.log(`\n${failed ? "VERIFY FAILED" : "VERIFY PASSED"}`);
process.exit(failed ? 1 : 0);
