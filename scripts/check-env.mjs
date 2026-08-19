import fs from "node:fs";
import path from "node:path";
function load(file) {
  const p=path.resolve(file); if(!fs.existsSync(p)) return;
  for(const raw of fs.readFileSync(p,"utf8").split(/\r?\n/)){
    const line=raw.trim(); if(!line||line.startsWith("#")) continue;
    const i=line.indexOf("="); if(i<1) continue;
    const k=line.slice(0,i).trim(); let v=line.slice(i+1).trim();
    if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
    if(!(k in process.env)) process.env[k]=v;
  }
}
load(".env"); load(".env.local");
const pairs = [
  ["Supabase URL", ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]],
  ["Supabase server key", ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]],
  ["Supabase public key", ["SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]],
  ["Telegram bot token", ["TELEGRAM_BOT_TOKEN"]],
  ["Session secret", ["SESSION_SECRET"]],
];
for (const [label, names] of pairs) {
  const found = names.find((name) => process.env[name]);
  console.log(`${found ? "OK     " : "MISSING"} ${label}${found ? ` (${found})` : ` — ${names.join(" / ")}`}`);
}
const tonApiKey = process.env.TONAPI_KEY;
console.log(`${tonApiKey ? "OK     " : "OPTIONAL"} TonAPI key${tonApiKey ? " (TONAPI_KEY)" : " — public rate-limited access will be used"}`);
