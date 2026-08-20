import { readFile } from 'node:fs/promises';

const [runtime,shell,css,rate,sql] = await Promise.all([
  readFile('src/legacy/runtime.ts','utf8'),
  readFile('src/legacy/game-shell.ts','utf8'),
  readFile('src/app/globals.css','utf8'),
  readFile('src/lib/security/rate-limit.ts','utf8'),
  readFile('supabase/schema_v12_4_FIX.sql','utf8')
]);
const fail=(m)=>{throw new Error(m)};
if(!runtime.includes('function rivalMetaV11')) fail('v11 rival helper missing');
const v11=runtime.split('/* ==================== v11 CONTENT + DUEL NETWORK ==================== */')[1]||'';
if(v11.includes('const m=rivalMeta(opp)')) fail('out-of-scope rivalMeta call remains');
if(!runtime.includes("const pageSize=state.duelSub==='tour'?3:DUEL_PAGE_SIZE") || !runtime.includes("const visible=pool.slice(duelPage*pageSize,duelPage*pageSize+pageSize)")) fail('compact duel pagination missing');
if(!shell.includes('КАРБОНОВАЯ ЛИГА') || !shell.includes('В СЕТИ')) fail('Russian duel UI missing');
if(!shell.includes('Казино синдиката')) fail('casino remaster missing');
if(!css.includes('.toast.toast-compact')) fail('compact toast missing');
if(!css.includes('.casino-card-premium')) fail('premium casino CSS missing');
if(!rate.includes('autosyndicate_rate_limit_v12_6') && !rate.includes('autosyndicate_rate_limit_v12_4')) fail('persistent rate limiter not wired');
if(!rate.includes('localFallback')) fail('emergency rate limiter missing');
if(!sql.includes('create table if not exists public.api_rate_limits_v12_4')) fail('v12.4 compatibility rate limit SQL missing');
if(!sql.includes('grant execute on function public.autosyndicate_rate_limit_v12_4')) fail('rate limit grant missing');
if(shell.includes('id="pvp-my-power">—') || shell.includes('id="dice-result" style="color:var(--text-muted);">—')) fail('numeric dash placeholders remain');
let depth=0; for(const c of css){if(c==='{')depth++;else if(c==='}')depth--;if(depth<0)fail('CSS brace underflow');} if(depth!==0)fail('CSS braces unbalanced');
console.log('AutoSyndicate v12.4 RU checks passed.');
