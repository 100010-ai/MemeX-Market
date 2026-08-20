import { readFile } from 'node:fs/promises';

const [runtime, shell, css, auth, verifier, env] = await Promise.all([
  readFile('src/legacy/runtime.ts','utf8'),
  readFile('src/legacy/game-shell.ts','utf8'),
  readFile('src/app/globals.css','utf8'),
  readFile('src/app/api/auth/telegram/route.ts','utf8'),
  readFile('src/lib/telegram/verify-init-data.ts','utf8'),
  readFile('src/lib/env.ts','utf8')
]);
const fail=(m)=>{throw new Error(m)};
for (const forbidden of ['SERVER ROLL','Server roll v10','schema_v12_2_FULL.sql','VERCEL ENV НЕ НАСТРОЕНЫ','БАЗА НЕ ГОТОВА']) {
  if (runtime.includes(forbidden) || shell.includes(forbidden)) fail(`player-facing developer text remains: ${forbidden}`);
}
if (!shell.includes('КАРБОНОВЫЙ РАЙОН') || !shell.includes('КАРБОНОВАЯ ЛИГА')) fail('commercial Russian Carbon shell markers missing');
if (!css.includes('AUTOSYNDICATE // COMMERCIAL CARBON REMASTER')) fail('remaster stylesheet missing');
if (!css.includes('content-visibility:auto')) fail('card rendering optimization missing');
if (!runtime.includes("const pageSize=state.duelSub==='tour'?3:DUEL_PAGE_SIZE") || !runtime.includes("const visible=pool.slice(duelPage*pageSize,duelPage*pageSize+pageSize)")) fail('compact duel pagination missing');
const rivalIds=[...runtime.matchAll(/\{id:'(npc_0(?:4[1-9]|5[0-9]|6[0-4]))',name:/g)].map((m)=>m[1]);
if (new Set(rivalIds).size < 24) fail('new duel rival pack incomplete');
if (!auth.includes("sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'")) fail('Telegram WebView cookie hardening missing');
if (!auth.includes("priority: 'high'")) fail('session cookie priority missing');
if (!verifier.includes('const cleanToken = botToken.trim()')) fail('Telegram token normalization missing');
if (!env.includes('function clean(value: string | undefined)')) fail('environment normalization missing');
let depth=0; for (const c of css) { if(c==='{') depth++; if(c==='}') depth--; if(depth<0) fail('CSS brace underflow'); }
if(depth!==0) fail(`CSS braces unbalanced: ${depth}`);
if(/\.reduce-motion \*,@media/.test(css)) fail('invalid reduced-motion selector found');
console.log(`UI remaster checks passed: ${new Set(rivalIds).size} new local rivals, commercial copy and security hardening present.`);
