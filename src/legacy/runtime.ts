// @ts-nocheck
import { createBrowserSupabase } from '@/lib/supabase/client';

/* ===== migrated from state.js ===== */
/* ==================== STATE / STORAGE 5.0 ==================== */
const SAVE_KEY = 'autosyndicate_save_v5';
const LEGACY_SAVE_KEYS = ['autosyndicate_save_v2'];
const MAX_SAVE_BYTES = 256 * 1024;
let state = defaultState();
let telegramInitData = '';

function defaultState(){
  return {
    playerName: 'Гонщик', playerPhoto:null, playerId:null,
    coins:1500, xp:0, level:1, nitro:2,
    ownedCars:[1], activeCarId:1, upgrades:{}, fuel:{}, condition:{},
    vehicleInstances:{}, plates:{}, tuningHistory:{}, caseHistory:[],
    stats:{races:0,wins:0,losses:0,bossWins:0,totalEarned:0,totalSpent:0,finesPaid:0,finesCount:0,casinoWagered:0,casinoWon:0,blackjackWins:0,casesOpened:0},
    jobCooldowns:{}, achievements:{}, dailyStreak:0, lastDailyClaim:0,
    settings:{sound:true,animations:true,haptics:true,reducedMotion:false,compactHud:false},
    logoTaps:0, secretBonusAt:0, duelSub:'normal',
    claimedSaleIds:[], claimedTransferIds:[], claimedPvpIds:[], bankSentLog:[],
    hasLicense:true, licenseSuspended:false, licenseSuspendCount:0,
    winStreak:0, raceHistory:[], tournamentRuns:{},
    raceStats:{perfectStarts:0,perfectShifts:0,hardLaunches:0,safeLaunches:0,radarEvents:0,policeStops:0,nitroUses:0},
    heat:0, districtRep:0, districtWins:{},
    contracts:{day:'',items:{}}, recentRaces:[],
    detailTargetId:null,tuneTargetId:null,
    createdAt:Date.now(), lastSaved:0
  };
}

function finiteNumber(v,fallback=0,min=-Infinity,max=Infinity){
  const n=Number(v); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
}
function intNumber(v,fallback=0,min=-2147483648,max=2147483647){
  return Math.trunc(finiteNumber(v,fallback,min,max));
}
function safeText(v,fallback='',max=80){
  if(typeof v!=='string') return fallback;
  return v.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max) || fallback;
}
function safePhotoUrl(v){
  if(typeof v!=='string' || v.length>800) return null;
  try{ const u=new URL(v); return (u.protocol==='https:'||u.protocol==='http:')?u.href:null; }catch(_){ return null; }
}
function safePlayerId(v){const x=safeText(v,'',96);return /^(tg_[0-9]{1,24}|guest_[A-Za-z0-9-]{8,80})$/.test(x)?x:null;}
function plainObject(v){ return !!v && typeof v==='object' && !Array.isArray(v) && Object.getPrototypeOf(v)===Object.prototype; }
function safeIdArray(v,max=500){
  if(!Array.isArray(v)) return [];
  return [...new Set(v.slice(0,max).map(x=>intNumber(x,NaN,1,100000)).filter(Number.isFinite))];
}
function validCarIds(){
  return typeof carsDB!=='undefined' ? new Set(carsDB.map(c=>c.id)) : null;
}
function normalizeRecordNumbers(src,min=0,max=1e9){
  const out={}; if(!plainObject(src)) return out;
  Object.keys(src).slice(0,300).forEach(k=>{ if(/^[\w-]{1,40}$/.test(k)) out[k]=finiteNumber(src[k],0,min,max); });
  return out;
}
function normalizeUpgrades(src){
  const out={}; if(!plainObject(src))return out;
  Object.keys(src).slice(0,100).forEach(k=>{
    if(!/^\d{1,6}$/.test(k)||!plainObject(src[k]))return;
    out[k]={engine:intNumber(src[k].engine,0,0,5),turbo:intNumber(src[k].turbo,0,0,5),gearbox:intNumber(src[k].gearbox??src[k].transmission,0,0,5),tires:intNumber(src[k].tires,0,0,5)};
  });return out;
}
function normalizeAchievements(src){
  const out={};if(!plainObject(src))return out;Object.keys(src).slice(0,200).forEach(k=>{if(/^[\w-]{1,64}$/.test(k)&&src[k])out[k]=true;});return out;
}
function normalizeTournamentRuns(src){
  const out={};if(!plainObject(src))return out;Object.keys(src).slice(0,100).forEach(k=>{const r=src[k];if(!plainObject(r))return;out[safeText(k,'',40)]={day:safeText(r.day,'',16),count:intNumber(r.count,0,0,3),next:intNumber(r.next,0,0,Date.now()+365*86400000)};});return out;
}
function normalizeContracts(src){
  if(!plainObject(src))return {day:'',items:{}};const out={day:safeText(src.day,'',16),items:{}};if(plainObject(src.items))Object.keys(src.items).slice(0,50).forEach(k=>{const r=src.items[k];if(plainObject(r)&&/^[\w-]{1,64}$/.test(k))out.items[k]={progress:intNumber(r.progress,0,0,1000),claimed:r.claimed===true};});return out;
}
function normalizeState(raw){
  const b=defaultState(), s=plainObject(raw)?raw:{};
  const stats=plainObject(s.stats)?s.stats:{};
  const raceStats=plainObject(s.raceStats)?s.raceStats:{};
  const settings=plainObject(s.settings)?s.settings:{};
  const carSet=validCarIds();
  let owned=safeIdArray(s.ownedCars,100);
  if(carSet) owned=owned.filter(id=>carSet.has(id));
  if(!owned.length) owned=[1];
  let active=intNumber(s.activeCarId,owned[0],1,100000);
  if(!owned.includes(active)) active=owned[0];

  const out={
    ...b,
    playerName:safeText(s.playerName,'Гонщик',48),
    playerPhoto:safePhotoUrl(s.playerPhoto),
    playerId:safePlayerId(s.playerId),
    coins:intNumber(s.coins,b.coins,0,1_000_000_000),
    xp:intNumber(s.xp,0,0,10_000_000), level:intNumber(s.level,1,1,999), nitro:intNumber(s.nitro,2,0,9999),
    ownedCars:owned, activeCarId:active,
    upgrades:normalizeUpgrades(s.upgrades), fuel:normalizeRecordNumbers(s.fuel,0,100), condition:normalizeRecordNumbers(s.condition,0,100),
    stats:{
      races:intNumber(stats.races,0,0,1e9), wins:intNumber(stats.wins,0,0,1e9), losses:intNumber(stats.losses,0,0,1e9), bossWins:intNumber(stats.bossWins,0,0,1e9),
      totalEarned:intNumber(stats.totalEarned,0,0,1e12), totalSpent:intNumber(stats.totalSpent,0,0,1e12),
      finesPaid:intNumber(stats.finesPaid,0,0,1e12), finesCount:intNumber(stats.finesCount,0,0,1e9),
      casinoWagered:intNumber(stats.casinoWagered,0,0,1e12), casinoWon:intNumber(stats.casinoWon,0,0,1e12), blackjackWins:intNumber(stats.blackjackWins,0,0,1e9), casesOpened:intNumber(stats.casesOpened,0,0,1e9)
    },
    jobCooldowns:normalizeRecordNumbers(s.jobCooldowns,0,Date.now()+365*86400000), achievements:normalizeAchievements(s.achievements),
    dailyStreak:intNumber(s.dailyStreak,0,0,9999), lastDailyClaim:intNumber(s.lastDailyClaim,0,0,Date.now()+86400000),
    settings:{sound:settings.sound!==false,animations:settings.animations!==false,haptics:settings.haptics!==false,reducedMotion:settings.reducedMotion===true,compactHud:settings.compactHud===true},
    logoTaps:intNumber(s.logoTaps,0,0,4), secretBonusAt:intNumber(s.secretBonusAt,0,0,Date.now()+86400000),
    duelSub:['normal','tour','pvp'].includes(s.duelSub)?s.duelSub:'normal',
    claimedSaleIds:safeIdArray(s.claimedSaleIds,500),claimedTransferIds:safeIdArray(s.claimedTransferIds,500),claimedPvpIds:safeIdArray(s.claimedPvpIds,500),
    bankSentLog:Array.isArray(s.bankSentLog)?s.bankSentLog.slice(-200).filter(x=>plainObject(x)).map(x=>({to:safeText(x.to,'',96),amount:intNumber(x.amount,0,0,1e7),ts:intNumber(x.ts,0,0,Date.now()+86400000)})).filter(x=>x.to&&x.amount):[],
    hasLicense:s.hasLicense!==false,licenseSuspended:s.licenseSuspended===true,licenseSuspendCount:intNumber(s.licenseSuspendCount,0,0,1000),
    winStreak:intNumber(s.winStreak,0,0,1e6),raceHistory:Array.isArray(s.raceHistory)?s.raceHistory.slice(-20).map(x=>safeText(String(x),'',40)).filter(Boolean):[],
    tournamentRuns:normalizeTournamentRuns(s.tournamentRuns),
    raceStats:{
      perfectStarts:intNumber(raceStats.perfectStarts,0,0,1e9),perfectShifts:intNumber(raceStats.perfectShifts,0,0,1e9),hardLaunches:intNumber(raceStats.hardLaunches,0,0,1e9),safeLaunches:intNumber(raceStats.safeLaunches,0,0,1e9),radarEvents:intNumber(raceStats.radarEvents,0,0,1e9),policeStops:intNumber(raceStats.policeStops,0,0,1e9),nitroUses:intNumber(raceStats.nitroUses,0,0,1e9)
    },
    heat:intNumber(s.heat,0,0,5),districtRep:intNumber(s.districtRep,0,0,1e9),districtWins:normalizeRecordNumbers(s.districtWins,0,1e9),
    contracts:normalizeContracts(s.contracts),
    recentRaces:Array.isArray(s.recentRaces)?s.recentRaces.slice(-12).filter(plainObject).map(r=>({
      ts:intNumber(r.ts,Date.now(),0,Date.now()+86400000),won:r.won===true,opponent:safeText(r.opponent,'Соперник',60),route:safeText(r.route,'Маршрут',40),time:finiteNumber(r.time,0,0,999),topSpeed:finiteNumber(r.topSpeed,0,0,500),perfectShifts:intNumber(r.perfectShifts,0,0,10),nitroUsed:r.nitroUsed===true
    })):[],
    detailTargetId:Number.isFinite(Number(s.detailTargetId))?intNumber(s.detailTargetId,null,1,100000):null,
    tuneTargetId:Number.isFinite(Number(s.tuneTargetId))?intNumber(s.tuneTargetId,null,1,100000):null,
    createdAt:intNumber(s.createdAt,Date.now(),0,Date.now()),lastSaved:intNumber(s.lastSaved,0,0,Date.now()+86400000)
  };
  // Never allow impossible derived stats to break profile math.
  out.stats.wins=Math.min(out.stats.wins,out.stats.races);
  out.stats.losses=Math.min(out.stats.losses,out.stats.races);
  return out;
}

function saveState(){
  try{
    state=normalizeState(state); state.lastSaved=Date.now();
    localStorage.setItem(SAVE_KEY,JSON.stringify(state));
    const el=document.getElementById('last-saved-text'); if(el)el.innerText=new Date(state.lastSaved).toLocaleTimeString('ru-RU');
  }catch(e){ console.warn('save failed',e); }
}
function loadState(){
  try{
    let raw=localStorage.getItem(SAVE_KEY);
    if(!raw){ for(const key of LEGACY_SAVE_KEYS){ raw=localStorage.getItem(key); if(raw)break; } }
    if(!raw || raw.length>MAX_SAVE_BYTES){ state=defaultState(); return; }
    state=normalizeState(JSON.parse(raw));
    localStorage.setItem(SAVE_KEY,JSON.stringify(state));
  }catch(e){ console.warn('load failed, using defaults',e); state=defaultState(); }
}
function manualSave(){ saveState(); showToast('Прогресс сохранён'); }
function exportSave(){
  saveState();
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='autosyndicate_carbon_save.json';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);showToast('Резервная копия создана');
}
function importSave(evt){
  const file=evt.target.files&&evt.target.files[0]; if(!file)return;
  if(file.size>MAX_SAVE_BYTES){showToast(' Файл слишком большой');evt.target.value='';return;}
  const reader=new FileReader();
  reader.onload=e=>{try{state=normalizeState(JSON.parse(String(e.target.result||'')));saveState();applyUiSettings();showToast('Прогресс восстановлен');switchTab('profile');}catch(_){showToast(' Неверный файл сохранения');}finally{evt.target.value='';}};
  reader.readAsText(file);
}
function resetProgress(){
  if(!confirm('Точно сбросить весь прогресс? Это действие необратимо.'))return;
  if(!confirm('Последнее предупреждение: машины, деньги и достижения будут удалены. Продолжить?'))return;
  localStorage.removeItem(SAVE_KEY);LEGACY_SAVE_KEYS.forEach(k=>localStorage.removeItem(k));state=defaultState();applyUiSettings();showToast('Новая карьера начата');switchTab('garage');
}
function applyUiSettings(){
  document.body.classList.toggle('reduce-motion',!!state.settings.reducedMotion);
  document.body.classList.toggle('compact-race-hud',!!state.settings.compactHud);
}
window.addEventListener('beforeunload',saveState);
setInterval(()=>{const racing=document.getElementById('screen-race')?.classList.contains('active');if(!racing)saveState();},30000);

/* ==================== TELEGRAM CONTEXT ==================== */
function initTelegram(){
  try{
    if(window.Telegram&&window.Telegram.WebApp){
      const tg=window.Telegram.WebApp; tg.ready();tg.expand();telegramInitData=typeof tg.initData==='string'?tg.initData:'';
      const u=tg.initDataUnsafe&&tg.initDataUnsafe.user;
      if(u){
        if(u.first_name&&(state.playerName==='Гонщик'||!state.playerName))state.playerName=safeText(u.first_name,'Гонщик',48);
        if(u.photo_url)state.playerPhoto=safePhotoUrl(u.photo_url);
        if(u.id)state.playerId='tg_'+String(u.id).replace(/[^0-9]/g,'').slice(0,24);
      }
    }
  }catch(e){console.warn('telegram init failed',e);}
  // The verified HttpOnly server session is authoritative for identity. This also restores
  // identity after Telegram WebView reloads where initData is briefly unavailable.
  try{
    const ss=window.__AUTOSYNDICATE_SERVER_SESSION__;
    if(ss?.playerId&&/^tg_[0-9]{1,24}$/.test(ss.playerId)){
      state.playerId=ss.playerId;
      if(ss.name)state.playerName=safeText(ss.name,'Гонщик',48);
      if(ss.username)state.playerUsername=safeText(ss.username,'',32).replace(/^@/,'').replace(/[^A-Za-z0-9_]/g,'');
    }
  }catch(_){ }
  if(!state.playerId){
    let local=localStorage.getItem('autosyndicate_local_id');
    if(!/^guest_[a-zA-Z0-9-]{8,80}$/.test(local||'')){
      const id=(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36);
      local='guest_'+id;localStorage.setItem('autosyndicate_local_id',local);
    }
    state.playerId=local;
  }
  applyUiSettings();
}
function escapeAttrLocal(s){return String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function avatarHTML(){
  const rawLetter=(state.playerName||'Г').charAt(0).toUpperCase();
  const letter=escapeAttrLocal(/^[0-9A-ZА-ЯЁ]$/i.test(rawLetter)?rawLetter:'Г');
  if(state.playerPhoto)return '<img src="'+escapeAttrLocal(state.playerPhoto)+'" alt="avatar" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement.textContent=\''+letter+'\'">';
  return letter;
}
function updateAvatarUI(){
  const h=document.getElementById('header-avatar');if(h)h.innerHTML=avatarHTML();
  const p=document.getElementById('avatar-letter');if(p)p.innerHTML=avatarHTML();
  const n=document.getElementById('nav-profile-ic');if(n&&state.playerPhoto)n.innerHTML='<div class="nav-avatar"><img src="'+escapeAttrLocal(state.playerPhoto)+'" referrerpolicy="no-referrer" onerror="this.closest(\'.nav-avatar\').remove()"></div>';
}


/* ===== migrated from data.js ===== */
/* ==================== CARS DB ==================== */
const carsDB = [
  { id:1, name:"ВАЗ-2106 'Шестёрка'", image:"/assets/cars/1.webp", price:0, power:150, tier:"Street Tier 1", cat:"street", flavor:"Легенда дворов. Заводится не с первого раза, зато душа поёт, когда наконец завёлся." },
  { id:2, name:"Volkswagen Golf Mk2", image:"/assets/cars/2.webp", price:700, power:190, tier:"Street Tier 1", cat:"street", flavor:"Немецкая надёжность по цене б/у самоката. Идеально для первых заработков." },
  { id:3, name:"Toyota AE86 Trueno", image:"/assets/cars/3.webp", price:1400, power:260, tier:"Street Tier 2", cat:"jdm", flavor:"Панда на колёсах. Говорят, кто-то развозил на такой тофу по горным серпантинам." },
  { id:4, name:"Nissan Silvia S15", image:"/assets/cars/4.webp", price:2600, power:350, tier:"Tuner Tier 2", cat:"jdm", flavor:"Дрифт-икона. На светофорах косятся, на трассе — уважают." },
  { id:5, name:"Mazda RX-7 FD", image:"/assets/cars/5.webp", price:3200, power:390, tier:"Tuner Tier 2", cat:"jdm", flavor:"Роторный движок воет как турбина. Соседи не любят, зато завидуют." },
  { id:6, name:"Toyota Supra MK4", image:"/assets/cars/6.webp", price:4400, power:430, tier:"Tuner Tier 3", cat:"jdm", flavor:"2JZ можно крутить бесконечно. Легенда подполья, проверено временем." },
  { id:7, name:"Mitsubishi Lancer Evo IX", image:"/assets/cars/7.webp", price:4900, power:450, tier:"Tuner Tier 3", cat:"jdm", flavor:"Полный привод и характер бойца. На мокром асфальте не подведёт." },
  { id:8, name:"Subaru Impreza WRX STI", image:"/assets/cars/8.webp", price:5100, power:465, tier:"Tuner Tier 3", cat:"jdm", flavor:"Оппозитный рокот слышно за квартал. Раллийные гены не пропьёшь." },
  { id:9, name:"Nissan Skyline GT-R R34", image:"/assets/cars/9.webp", price:6800, power:500, tier:"Tuner Tier 3", cat:"jdm", flavor:"Godzilla. Просто Godzilla. На этом можно закончить описание." },
  { id:10, name:"Ford Mustang GT", image:"/assets/cars/10.webp", price:3400, power:440, tier:"Muscle Tier 3", cat:"muscle", flavor:"Американская классика. Жрёт бензин как не в себя, но звук V8 того стоит." },
  { id:11, name:"Dodge Challenger SRT", image:"/assets/cars/11.webp", price:5400, power:490, tier:"Muscle Tier 3", cat:"muscle", flavor:"Тяжёлый, злой, прямолинейный. На драге — король." },
  { id:12, name:"Chevrolet Camaro SS", image:"/assets/cars/12.webp", price:5700, power:505, tier:"Muscle Tier 3", cat:"muscle", flavor:"Низкий, широкий, агрессивный силуэт. Дизайнеры не сдерживались." },
  { id:13, name:"BMW M4 Competition", image:"/assets/cars/13.webp", price:7600, power:520, tier:"Sport Tier 4", cat:"sport", flavor:"Баварский хирургический инструмент. Точность в каждом повороте." },
  { id:14, name:"Mercedes-AMG GT", image:"/assets/cars/14.webp", price:8300, power:560, tier:"Sport Tier 4", cat:"sport", flavor:"Длинный капот, короткий характер. AMG не терпит компромиссов." },
  { id:15, name:"Audi RS6 Avant", image:"/assets/cars/15.webp", price:8700, power:575, tier:"Sport Tier 4", cat:"sport", flavor:"Универсал, который порвёт половину спорткаров. Quattro не обманывает." },
  { id:16, name:"Porsche 911 Turbo S", image:"/assets/cars/16.webp", price:13500, power:660, tier:"Supercar Tier 5", cat:"super", flavor:"Инженерное совершенство Штутгарта. Заезд — формальность, победа — данность." },
  { id:17, name:"Porsche 911 GT3 RS", image:"/assets/cars/17.webp", price:15800, power:700, tier:"Supercar Tier 5", cat:"super", flavor:"Трековый снаряд с номерами. Антикрыло не для красоты." },
  { id:18, name:"Audi R8 V10", image:"/assets/cars/18.webp", price:17200, power:730, tier:"Supercar Tier 5", cat:"super", flavor:"Атмосферная десятка ревёт так, что закладывает уши прохожим." },
  { id:19, name:"Nissan GT-R R35", image:"/assets/cars/19.webp", price:18900, power:750, tier:"Supercar Tier 5", cat:"super", flavor:"Компьютерный мозг и звериная тяга. Из коробки готов рвать полигон." },
  { id:20, name:"McLaren 720S", image:"/assets/cars/20.webp", price:24500, power:790, tier:"Supercar Tier 5", cat:"super", flavor:"Глаза-фары смотрят прямо в душу соперника ещё до старта." },
  { id:21, name:"Ferrari 488 Pista", image:"/assets/cars/21.webp", price:32000, power:860, tier:"Hypercar Tier 6", cat:"hyper", flavor:"Red is the fastest colour, как говорят в Маранелло." },
  { id:22, name:"Ferrari SF90 Stradale", image:"/assets/cars/22.webp", price:38500, power:900, tier:"Hypercar Tier 6", cat:"hyper", flavor:"Гибрид, который стыдно называть гибридом. Разгон рвёт шею." },
  { id:23, name:"Lamborghini Huracan", image:"/assets/cars/23.webp", price:42000, power:930, tier:"Hypercar Tier 6", cat:"hyper", flavor:"Итальянский бык на асфальте. Соседи снимают на телефон каждый выезд." },
  { id:24, name:"Lamborghini Aventador", image:"/assets/cars/24.webp", price:52000, power:975, tier:"Legendary Boss", cat:"legend", flavor:"Ножничные двери — билет в клуб избранных подполья." },
  { id:25, name:"Bugatti Chiron", image:"/assets/cars/25.webp", price:78000, power:1200, tier:"Legendary Boss", cat:"legend", flavor:"Не машина — произведение искусства с мотором W16. Топ пищевой цепи." },
  { id:26, name:"Carbon Wraith", image:null, price:95000, power:1350, tier:"Mythic", cat:"myth", flavor:"Закрытая серия Carbon District. Экстремально лёгкая платформа, настроенная под максимальную скорость." },
  { id:27, name:"Project Zero", image:null, price:62000, power:1120, tier:"Mythic", cat:"myth", flavor:"Экспериментальная уличная сборка без серийных обозначений. Баланс тяги, массы и длинных передач." }
];

/* ===== BALANCED ECONOMY v12.6 =====
   Progression is intentionally paced for weeks: early cars are reachable,
   high-end cars require career/ranked play instead of a one-day grind. */
const ECONOMY_V12_6 = {
  carPrices:{1:0,2:3600,3:8200,4:14500,5:19000,6:27500,7:34000,8:39000,9:52000,10:30000,11:45000,12:49000,13:68000,14:78000,15:85000,16:120000,17:150000,18:175000,19:205000,20:255000,21:330000,22:410000,23:470000,24:650000,25:900000,26:1350000,27:1100000},
  casinoMax:()=>Math.max(50,Math.min(Number(state?.coins)||0,2500,100+(Number(state?.level)||1)*60)),
  raceReward:(opp:any)=>{
    const power=Math.max(100,Number(opp?.power)||200),lvl=Math.max(1,Number(opp?.unlockLevel)||1);
    const base=Math.max(90,Math.round(power*.50+lvl*13));
    return Math.round(base*(opp?.boss?1.35:1));
  }
};
function applyEconomyCarPrices(list:any[]=carsDB){list.forEach((car:any)=>{const v=(ECONOMY_V12_6.carPrices as any)[Number(car.id)];if(Number.isFinite(v))car.price=v;});return list;}
function economyRaceReward(opp:any){return ECONOMY_V12_6.raceReward(opp);}
applyEconomyCarPrices(carsDB);

const CAT_LABELS = { street:"Уличный", jdm:"JDM тюнер", muscle:"Масл-кар", sport:"Спорт", super:"Суперкар", hyper:"Гиперкар", legend:"Легенда", myth:"Миф подполья" };
const CAT_COLORS = { street:['#94a3b8','#334155'], jdm:['#38bdf8','#0c4a6e'], muscle:['#fb923c','#7c2d12'], sport:['#a78bfa','#4c1d95'], super:['#fb7185','#4c0519'], hyper:['#fbbf24','#78350f'], legend:['#facc15','#713f12'], myth:['#c084fc','#1e1033'] };

/* ==================== CAR ART (SVG, matches by category — no more mismatched photos) ==================== */
function carArtSVG(car){
  if(car.image){
    return '<img class="car-real-image" src="'+String(car.image).replace(/"/g,'&quot;')+'" alt="'+String(car.name).replace(/"/g,'&quot;')+'" loading="lazy">';
  }
  const col = CAT_COLORS[car.cat] || CAT_COLORS.street;
  const c1=col[0], c2=col[1];
  const shape = ['street','jdm','muscle'].includes(car.cat) ? 'classic' : (['sport','super'].includes(car.cat) ? 'coupe' : 'hyper');
  const gid = 'g'+car.id;
  const spoiler = shape==='hyper' ? '<rect x="150" y="53" width="58" height="6" rx="2" fill="'+c1+'"/><rect x="154" y="41" width="6" height="15" fill="'+c1+'"/><rect x="198" y="41" width="6" height="15" fill="'+c1+'"/>' : '';
  let body;
  if(shape==='classic'){
    body = '<path d="M20 110 Q20 90 45 88 L70 60 Q80 50 100 50 L160 50 Q180 50 190 65 L215 88 Q240 90 240 110 L240 118 Q240 124 232 124 L28 124 Q20 124 20 118 Z" fill="url(#'+gid+')"/>';
  } else if(shape==='coupe'){
    body = '<path d="M15 112 Q15 88 42 85 L65 55 Q78 42 105 42 L165 42 Q188 44 200 60 L222 85 Q245 88 245 112 L245 120 Q245 126 237 126 L23 126 Q15 126 15 120 Z" fill="url(#'+gid+')"/>';
  } else {
    body = '<path d="M10 114 Q10 95 35 90 L60 62 Q75 44 110 42 L160 42 Q195 44 208 65 L228 90 Q250 92 250 114 L250 122 Q250 127 242 127 L18 127 Q10 127 10 122 Z" fill="url(#'+gid+')"/>';
  }
  const hueShift = ((car.id*29) % 40) - 20;
  return '<svg viewBox="0 0 260 150" preserveAspectRatio="xMidYMid slice" style="filter:hue-rotate('+hueShift+'deg)">'+
    '<defs><linearGradient id="'+gid+'" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="'+c1+'"/><stop offset="1" stop-color="'+c2+'"/></linearGradient>'+
    '<linearGradient id="bgg'+gid+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e0e16"/><stop offset="1" stop-color="#050508"/></linearGradient></defs>'+
    '<rect width="260" height="150" fill="url(#bgg'+gid+')"/>'+
    '<ellipse cx="130" cy="129" rx="112" ry="9" fill="'+c1+'" opacity="0.18"/>'+
    body + spoiler +
    '<rect x="35" y="66" width="185" height="2" fill="rgba(255,255,255,.15)"/>'+
    '<circle cx="65" cy="126" r="17" fill="#0a0a0e" stroke="'+c1+'" stroke-width="3"/><circle cx="65" cy="126" r="6" fill="'+c1+'"/>'+
    '<circle cx="195" cy="126" r="17" fill="#0a0a0e" stroke="'+c1+'" stroke-width="3"/><circle cx="195" cy="126" r="6" fill="'+c1+'"/>'+
    '<rect x="205" y="94" width="15" height="6" rx="2" fill="#fff" opacity="0.9"/>'+
    '<rect x="28" y="94" width="10" height="5" rx="2" fill="#ff3b3b" opacity="0.85"/>'+
    '</svg>';
}

/* ==================== TUNING (5 stages + Nitro + Tires) ==================== */
const TUNE_TYPES = [
  { key:"engine", name:"Двигатель", icon:"", desc:"Прошивка ЭБУ и доработка мотора", hpPerStage:[0.08,0.09,0.10,0.11,0.12] },
  { key:"turbo", name:"Турбина", icon:"", desc:"Больше буст — больше тяги", hpPerStage:[0.06,0.07,0.08,0.09,0.10] },
  { key:"gearbox", name:"КПП", icon:"", desc:"Короткие передачи, быстрее разгон", hpPerStage:[0.05,0.06,0.06,0.07,0.08] },
  { key:"tires", name:"Резина", icon:"", desc:"Слики держат разгон без пробуксовки", hpPerStage:[0.03,0.04,0.05,0.05,0.06] }
];
function getUpg(carId){ if(!state.upgrades[carId]) state.upgrades[carId]={engine:0,turbo:0,gearbox:0,tires:0}; TUNE_TYPES.forEach(t=>{ if(state.upgrades[carId][t.key]===undefined) state.upgrades[carId][t.key]=0; }); return state.upgrades[carId]; }
function getEffectivePower(car){
  const upg=getUpg(car.id); let mult=1;
  TUNE_TYPES.forEach(t=>{ const lvl=upg[t.key]; for(let i=0;i<lvl;i++) mult+=t.hpPerStage[i]; });
  const cond = getCondition(car.id);
  if(cond<40) mult*=0.85; else if(cond<70) mult*=0.93;
  return Math.round(car.power*mult);
}
function tuneStagePrice(car,stageIndex){ const base=Math.max(250,Math.round(car.price*0.10)); return Math.round(base*(stageIndex+1)*1.6); }


/* ==================== OPPONENTS / TOURNAMENTS ==================== */
const opponentsDB = [
  { id:1, name:"Riot", image:null, power:220, reward:220, unlockLevel:1, taunt:"Первый старт решает больше, чем кажется." },
  { id:2, name:"Kade", image:null, power:340, reward:380, unlockLevel:1, taunt:"Не смотри на кузов. Смотри на мой старт." },
  { id:3, name:"Avery", image:null, power:480, reward:650, unlockLevel:2, taunt:"Увидимся на следующей передаче." },
  { id:4, name:"Phoenix", image:null, power:620, reward:1100, unlockLevel:4, taunt:"«Тут тебе не покатушки, тут дуэль.»" },
  { id:5, name:"Vektor", image:null, power:780, reward:2000, unlockLevel:6, taunt:"«Многие пытались. Мало кто финишировал первым.»" },
  { id:6, name:"Shade", image:null, power:950, reward:3600, unlockLevel:8, taunt:"Ни слова до финиша." },
  { id:7, name:"Darian", image:null, power:1150, reward:6000, unlockLevel:11, taunt:"«Я жду соперника десять лет. Ты следующий проигравший.»", boss:true },
  { id:8, name:"Midnight", image:null, power:1350, reward:10000, unlockLevel:14, taunt:"«Никто не побеждал меня дважды. Некоторые — ни разу.»", boss:true },
  { id:9, name:"Syndicate Zero", image:null, power:1550, reward:20000, unlockLevel:18, taunt:"«Ты хоть знаешь, кто здесь всем заправляет?»", boss:true }
];
const tournamentsDB = [
  { id:'t1', name:"Ночной Кубок", power:500, reward:2500, entryFee:300, unlockLevel:3, taunt:"Ночной турнир для смелых новичков." },
  { id:'t2', name:"Кубок Синдиката", power:900, reward:9000, entryFee:1200, unlockLevel:7, taunt:"Только сильнейшие доходят до финала." },
  { id:'t3', name:"Гран-При Подполья", power:1400, reward:30000, entryFee:4000, unlockLevel:13, taunt:"Легенды подполья рождаются здесь." }
];
function entryFeeFor(opp){ return opp.entryFee!==undefined ? opp.entryFee : Math.round(opp.reward*0.12)+20; }
function fuelCostFor(opp){ return opp.boss ? 26 : (opp.entryFee!==undefined ? 22 : 14); }

/* ==================== JOBS ==================== */
const jobsDB = [
  { id:"wash", name:"Мойка тачек в гараже", desc:"Стабильный небольшой заработок", reward:60, xp:4, cooldown:90 },
  { id:"delivery", name:"Доставка запчастей", desc:"Средняя смена с нормальной выплатой", reward:110, xp:7, cooldown:240 },
  { id:"taxi", name:"Ночной таксист", desc:"Длинная смена с повышенной выплатой", reward:190, xp:11, cooldown:600 }
];

/* ==================== ДПС (ПОЛИЦИЯ) ==================== */
const POLICE_LINES = [
  "«Документы, инструмент, вот это всё.»",
  "«Куда спешим, гонщик?»",
  "«Радар показал интересную циферку.»",
  "«Ты не в кино, притормози.»",
  "«Опять ты? Третий раз за неделю вижу эту тачку.»"
];
const POLICE_BASE_FINE = 180;
const LICENSE_BASE_PRICE = 900;
function licensePrice(){ return LICENSE_BASE_PRICE + state.licenseSuspendCount*350; }

/* ==================== БАНК ==================== */
const BANK_MAX_PER_TRANSFER = 800;
const BANK_MAX_PER_DAY = 2000;
const BANK_COOLDOWN_MS = 10*60*1000; // 10 минут между переводами одному игроку



/* ==================== CARBON VEHICLE SYSTEM ==================== */
const plateRarities = {
  common:{chance:70,value:1},
  rare:{chance:22,value:5},
  epic:{chance:7,value:15},
  legendary:{chance:1,value:50}
};

const caseDrops = [
 {type:'money',name:'SYND Credits',rarity:'common'},
 {type:'tune',name:'Stage Engine Upgrade',rarity:'rare'},
 {type:'plate',name:'777 CARBON',rarity:'epic'},
 {type:'car',name:'Rare Vehicle',rarity:'legendary'}
];

function generatePlate(){
  const pool=[
    'A123AA','X777XX','777 CARBON','RACE 01',
    'NFS KING','666 BOSS','RZR 777'
  ];
  return pool[Math.floor(Math.random()*pool.length)];
}


/* ===== migrated from game.js ===== */
/* ==================== FUEL / CONDITION ==================== */
function getFuel(carId){ if(state.fuel[carId]===undefined) state.fuel[carId]=100; return state.fuel[carId]; }
function getCondition(carId){ if(state.condition[carId]===undefined) state.condition[carId]=100; return state.condition[carId]; }
function fuelPricePerUnit(car){ return Math.max(1, Math.round(car.price/2500)+1); }
function repairPricePerUnit(car){ return Math.max(2, Math.round(car.price/1400)+2); }
function refuelCar(carId){
  const car=carsDB.find(c=>c.id===carId);
  const need = 100-getFuel(carId);
  if(need<=0){ showToast("Бак уже полон"); return; }
  const cost = need*fuelPricePerUnit(car);
  if(state.coins<cost){ showToast("Недостаточно денег на заправку"); return; }
  state.coins-=cost; state.stats.totalSpent+=cost; state.fuel[carId]=100;
  showToast(" Заправлено за "+fmt(cost)+" ");
  saveState(); openDetail(carId);
}
function repairCar(carId){
  const car=carsDB.find(c=>c.id===carId);
  const need = 100-getCondition(carId);
  if(need<=0){ showToast("Машина в идеальном состоянии"); return; }
  const cost = need*repairPricePerUnit(car);
  if(state.coins<cost){ showToast("Недостаточно денег на ремонт"); return; }
  state.coins-=cost; state.stats.totalSpent+=cost; state.condition[carId]=100;
  showToast(" Отремонтировано за "+fmt(cost)+" ");
  saveState(); openDetail(carId);
}

/* ==================== XP / LEVEL ==================== */
function xpNeeded(lvl){ return 160+lvl*110+lvl*lvl*18; }
function addXP(n){
  state.xp+=n;
  let leveled=false;
  while(state.xp>=xpNeeded(state.level)){ state.xp-=xpNeeded(state.level); state.level++; leveled=true; }
  if(leveled){ const bonus=Math.min(1000,60+state.level*20); awardMoney(bonus,'ПОВЫШЕНИЕ УРОВНЯ'); showToast('Новый уровень · LVL '+state.level); }
  updateHeader();
}


/* ==================== UTIL ==================== */
function fmt(n){ return Math.round(n).toLocaleString('ru-RU'); }
let toastTimer:any=null;
let lastToastText='';
let lastToastAt=0;
function showToast(msg){
  const text=String(msg??'').trim();
  if(!text)return;
  const now=Date.now();
  let t=document.getElementById('autosyndicate-toast');
  if(!t){
    t=document.createElement('div');
    t.id='autosyndicate-toast';
    t.className='toast toast-compact';
    t.setAttribute('role','status');
    t.setAttribute('aria-live','polite');
    document.body.appendChild(t);
  }
  if(text===lastToastText&&now-lastToastAt<1200){
    if(toastTimer)clearTimeout(toastTimer);
  }
  lastToastText=text;lastToastAt=now;
  t.textContent=text;
  t.classList.remove('hide');
  t.classList.add('show');
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{
    t?.classList.remove('show');
    t?.classList.add('hide');
  },2200);
}
function flashResult(el, win){
  if(!state.settings.animations || !el) return;
  el.classList.remove('win-flash','lose-flash');
  void el.offsetWidth;
  el.classList.add(win?'win-flash':'lose-flash');
}
function tapLogo(){
  state.logoTaps=(state.logoTaps||0)+1;
  if(state.logoTaps<5) return;
  state.logoTaps=0;
  const now=Date.now();
  if(now-(state.secretBonusAt||0)<24*60*60*1000){ showToast('Синдикат уже выдал скрытый бонус сегодня.'); saveState(); return; }
  state.secretBonusAt=now; state.coins+=250; state.stats.totalEarned+=250; state.nitro+=1;
  showToast(' Тайник синдиката: +250 SYND и 1 нитро');
  haptic('success'); updateHeader(); saveState(); checkAchievements();
}

/* ==================== NAV ==================== */
const TAB_MAP = {garage:0,shop:1,'duel-select':2,casino:3,profile:4};
function switchTab(tabId){
  if(raceCtx && !raceCtx.finished && document.getElementById('screen-race')?.classList.contains('active') && tabId!=='race'){
    if(!confirm('Заезд ещё не закончен. Покинуть трассу? Вход и топливо не возвращаются.')) return;
    raceCtx.finished=true; if(raceCtx.raf) cancelAnimationFrame(raceCtx.raf); if(raceCtx.launchIv) clearInterval(raceCtx.launchIv);
  }
  document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(x=>x.classList.remove('active'));
  const target=document.getElementById('screen-'+tabId); if(!target) return;
  target.classList.add('active');
  const buttons=document.querySelectorAll('.nav-btn'); if(TAB_MAP[tabId]!==undefined && buttons[TAB_MAP[tabId]]) buttons[TAB_MAP[tabId]].classList.add('active');
  document.getElementById('main-scroll').scrollTop=0;
  if(tabId==='garage')renderGarage();
  if(tabId==='shop')renderShop();
  if(tabId==='duel-select')renderOpponents();
  if(tabId==='jobs')renderJobs();
  if(tabId==='profile')renderProfile();
  if(tabId==='casino')renderCasinoHub();
  if(tabId==='achievements')renderAchievements();
  if(tabId==='cases')renderCases();
  if(tabId==='leaderboard')renderLeaderboard();
  if(tabId==='settings')renderSettings();
  if(tabId==='market')openMarket();
  if(tabId==='chat')openChat();
  if(tabId==='bank')openBank();
  if(tabId==='districts')renderDistricts();
  if(tabId==='contracts')renderContracts();
  saveState();
}
function switchDuelSub(sub){
  state.duelSub=sub;
  document.getElementById('dsub-normal').classList.toggle('active', sub==='normal');
  document.getElementById('dsub-tour').classList.toggle('active', sub==='tour');
  document.getElementById('dsub-pvp').classList.toggle('active', sub==='pvp');
  document.getElementById('opponent-list').style.display = sub==='pvp' ? 'none' : '';
  document.getElementById('pvp-wrap').style.display = sub==='pvp' ? '' : 'none';
  if(sub==='pvp'){
    const car=carsDB.find(c=>c.id===state.activeCarId);
    document.getElementById('pvp-my-power').innerText = car ? getEffectivePower(car)+' л.с.' : '0 л.с.';
    openPvp();
  } else {
    renderOpponents();
  }
}

function updateHeader(){
  const coins=document.getElementById('coins-display'),lvl=document.getElementById('lvl-display');
  if(coins)coins.innerText=fmt(state.coins); if(lvl)lvl.innerText=state.level;
}

/* ==================== GARAGE / SHOP ==================== */
function renderGarage(){
  updateHeader();
  const container=document.getElementById('garage-list'); if(!container)return;
  document.getElementById('garage-count').innerText=state.ownedCars.length+' машин';
  renderGarageTools(); container.innerHTML='';
  let myCars=carsDB.filter(c=>state.ownedCars.includes(c.id));
  if(garageSort==='power') myCars.sort((a,b)=>getEffectivePower(b)-getEffectivePower(a));
  else if(garageSort==='condition') myCars.sort((a,b)=>getCondition(b.id)-getCondition(a.id));
  else myCars.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  myCars.forEach(car=>{
    const isActive=state.activeCarId===car.id,eff=getEffectivePower(car),fuel=getFuel(car.id),cond=getCondition(car.id);
    container.innerHTML+='<div class="car-card" style="'+(isActive?'border-color:var(--accent);':'')+'">'+
      '<div class="car-thumb" onclick="openDetail('+car.id+')">'+carArtSVG(car)+'<div class="tier-badge">'+car.tier+'</div><div class="power-badge">'+eff+' л.с.</div></div>'+
      '<div class="car-info-box"><div class="car-title">'+car.name+'</div><div class="car-stats"><div>Статус: <span style="color:'+(isActive?'var(--accent-2)':'var(--green)')+'">'+(isActive?'АКТИВНА':'В ГАРАЖЕ')+'</span></div><div> <span style="color:'+(fuel<25?'var(--danger)':'#fff')+'">'+fuel+'%</span></div><div> <span style="color:'+(cond<40?'var(--danger)':'#fff')+'">'+cond+'%</span></div></div>'+
      '<div class="btn-row">'+(!isActive?'<button class="btn btn-select" onclick="selectCar('+car.id+')">ВЫБРАТЬ</button>':'<button class="btn btn-select selected-mark" disabled>АКТИВНА</button>')+'<button class="btn btn-ghost" onclick="openDetail('+car.id+')">КАРТОЧКА</button></div></div></div>';
  });
}

function renderShop(){
  updateHeader(); const container=document.getElementById('shop-list'); if(!container)return;
  renderShopToolbar(); container.innerHTML='';
  let list=carsDB.filter(c=>shopCategory==='all'||c.cat===shopCategory);
  if(shopSort==='power')list=list.slice().sort((a,b)=>b.power-a.power); else list=list.slice().sort((a,b)=>a.price-b.price);
  list.forEach(car=>{
    const isOwned=state.ownedCars.includes(car.id),canAfford=state.coins>=car.price;
    container.innerHTML+='<div class="car-card"><div class="car-thumb" onclick="openDetail('+car.id+')">'+carArtSVG(car)+'<div class="tier-badge">'+car.tier+'</div><div class="power-badge">'+car.power+' л.с.</div></div>'+
      '<div class="car-info-box"><div class="car-title">'+car.name+'</div><div class="car-stats"><span>'+CAT_LABELS[car.cat]+'</span><span>'+(car.price===0?'Стартовая':fmt(car.price)+' SYND')+'</span></div><div class="btn-row">'+
      (isOwned?'<button class="btn btn-buy" disabled>В ГАРАЖЕ</button>':'<button class="btn btn-buy" '+(canAfford?'':'disabled')+' onclick="buyCar('+car.id+')">'+(canAfford?'КУПИТЬ':'НЕ ХВАТАЕТ')+'</button>')+'<button class="btn btn-ghost" onclick="openDetail('+car.id+')">КАРТОЧКА</button></div></div></div>';
  });
}
function buyCar(carId){
  const car=carsDB.find(c=>c.id===carId); if(!car||state.ownedCars.includes(carId))return;
  if(state.coins<car.price){showToast('Недостаточно SYND');haptic('error');return;}
  state.coins-=car.price;state.stats.totalSpent+=car.price;state.ownedCars.push(carId);getFuel(carId);getCondition(carId);getUpg(carId);
  showToast(' В гараже: '+car.name);haptic('success');recordContractEvent('buy',1);updateHeader();renderShop();saveState();checkAchievements();
}
function selectCar(carId){
  if(!state.ownedCars.includes(carId))return; state.activeCarId=carId;showToast(' Активная машина изменена');haptic('light');renderGarage();saveState();
}

/* ==================== CAR DETAIL ==================== */
function openDetail(carId){
  state.detailTargetId=carId;
  const car=carsDB.find(c=>c.id===carId);
  const isOwned=state.ownedCars.includes(carId);
  const eff=getEffectivePower(car);
  const powerPct=Math.min(100, Math.round(eff/1500*100));
  const fuel=getFuel(carId), cond=getCondition(carId);
  let html = '<div class="detail-hero">'+carArtSVG(car)+'<div class="detail-hero-text"><h2>'+car.name+'</h2><div style="color:var(--text-muted);font-weight:800;font-size:12px;text-transform:uppercase;">'+car.tier+'</div></div></div>'+
    '<div class="flavor-box">"'+car.flavor+'"</div>'+
    '<div class="stat-row"><div class="stat-line"><span>Мощность</span><b>'+eff+' л.с.'+(eff!==car.power?' (баз. '+car.power+')':'')+'</b></div><div class="stat-bar-bg"><div class="stat-bar-fill" style="width:'+powerPct+'%;background:var(--accent);"></div></div>'+
    '<div class="stat-line" style="margin-top:8px;"><span>Класс</span><b>'+CAT_LABELS[car.cat]+'</b></div>'+
    '<div class="stat-line"><span>Цена</span><b>'+(car.price===0?'Стартовая':fmt(car.price)+' ')+'</b></div></div>';

  if(isOwned){
    html += '<div class="resource-row">'+
      '<div class="resource-box"><div class="resource-head"><span> Топливо</span><b>'+fuel+'%</b></div><div class="stat-bar-bg"><div class="stat-bar-fill" style="width:'+fuel+'%;background:var(--blue);"></div></div></div>'+
      '<div class="resource-box"><div class="resource-head"><span> Состояние</span><b>'+cond+'%</b></div><div class="stat-bar-bg"><div class="stat-bar-fill" style="width:'+cond+'%;background:'+(cond<40?'var(--accent)':'var(--green)')+';"></div></div></div>'+
    '</div>'+
    '<div class="btn-row" style="max-width:520px;width:100%;margin-bottom:10px;">'+
      '<button class="btn btn-ghost" onclick="refuelCar('+carId+')">ЗАПРАВИТЬ</button>'+
      '<button class="btn btn-ghost" onclick="repairCar('+carId+')">РЕМОНТ</button>'+
    '</div>'+
    '<div class="list-container" style="max-width:520px;">'+
      (state.activeCarId!==carId ? '<button class="btn btn-select" onclick="selectCar('+carId+')">СДЕЛАТЬ АКТИВНОЙ</button>' : '<button class="btn btn-select selected-mark" disabled>АКТИВНАЯ МАШИНА</button>')+
      '<button class="btn btn-gold" onclick="openTune('+carId+')"> ТЮНИНГ</button>'+
    '</div>';
  } else {
    const canAfford = state.coins>=car.price;
    html += '<div class="list-container" style="max-width:520px;"><button class="btn btn-buy" '+(canAfford?'':'disabled')+' onclick="buyCar('+carId+');openDetail('+carId+')">'+(canAfford?'КУПИТЬ ЗА '+fmt(car.price)+' ':'НЕДОСТАТОЧНО СРЕДСТВ')+'</button></div>';
  }
  document.getElementById('detail-content').innerHTML = html;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-cardetail').classList.add('active');
  document.getElementById('main-scroll').scrollTop=0;
}
function goBackFromDetail(){
  if(state.ownedCars.includes(state.detailTargetId)) switchTab('garage'); else switchTab('shop');
}

/* ==================== TUNING ==================== */
function openTune(carId){
  state.tuneTargetId=carId;
  const car=carsDB.find(c=>c.id===carId);
  document.getElementById('tune-car-title').innerText = "Тюнинг: "+car.name;
  const upg=getUpg(carId);
  const container=document.getElementById('tune-list');
  container.innerHTML='';
  TUNE_TYPES.forEach(t=>{
    const lvl=upg[t.key];
    const maxed = lvl>=t.hpPerStage.length;
    const price = maxed? 0 : tuneStagePrice(car,lvl);
    const canAfford = state.coins>=price;
    let dots='';
    for(let i=0;i<t.hpPerStage.length;i++) dots+='<div class="dot '+(i<lvl?'filled':'')+'"></div>';
    container.innerHTML += '<div class="tune-row">'+
      '<div><div class="tune-name">'+t.icon+' '+t.name+' <span style="color:var(--text-muted);font-weight:700;font-size:10.5px;">Ст.'+lvl+'/'+t.hpPerStage.length+'</span></div>'+
      '<div class="tune-desc">'+t.desc+'</div><div class="tune-level-dots">'+dots+'</div></div>'+
      '<button class="tune-btn '+(maxed?'maxed':'')+'" '+(maxed||!canAfford?'disabled':'')+' onclick="upgradeTune('+carId+',\''+t.key+'\')">'+(maxed?'МАКС':fmt(price)+' ')+'</button>'+
    '</div>';
  });
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-tune').classList.add('active');
  document.getElementById('main-scroll').scrollTop=0;
}
function upgradeTune(carId, key){
  const car=carsDB.find(c=>c.id===carId);
  const upg=getUpg(carId);
  const t=TUNE_TYPES.find(x=>x.key===key);
  if(upg[key]>=t.hpPerStage.length) return;
  const price=tuneStagePrice(car,upg[key]);
  if(state.coins<price){ showToast("Недостаточно денег"); return; }
  state.coins-=price; state.stats.totalSpent+=price;
  upg[key]++;
  showToast(" "+t.name+" улучшена до стадии "+upg[key]);
  updateHeader(); openTune(carId); saveState();
  checkAchievements();
}

/* ==================== DUEL SELECT ==================== */
function renderOpponents(){
  updateHeader();
  const container=document.getElementById('opponent-list');
  container.innerHTML='';
  const car=carsDB.find(c=>c.id===state.activeCarId);
  if(!car){ container.innerHTML='<div class="no-car-msg">Сначала выберите активную машину в гараже.</div>'; return; }
  if(state.licenseSuspended){
    container.innerHTML='<div class="sell-picker" style="border-color:#63333e;"><div style="font-size:18px;"></div><b style="display:block;margin:6px 0;">Права временно изъяты</b><div class="empty-note" style="padding:0;text-align:left;">Но это не тупик. Можно заработать через подработку или получить перевод в банке.</div><div class="btn-row" style="margin-top:10px;"><button class="btn btn-gold" onclick="switchTab(\'jobs\')">ПОДРАБОТКА</button><button class="btn btn-ghost" onclick="switchTab(\'bank\')">БАНК</button></div></div>';
    return;
  }
  const list=state.duelSub==='tour'?tournamentsDB:opponentsDB;
  const myPower=getEffectivePower(car);
  const history=state.raceHistory||[];
  const available=list.filter(o=>state.level>=o.unlockLevel);
  if(state.duelSub==='tour'){
    const now=Date.now();
    const dayKey=new Date().toISOString().slice(0,10);
    const statusText=(o)=>{
      const r=state.tournamentRuns[String(o.id)]||{};
      if(r.day!==dayKey) return {count:0,next:0,day:dayKey};
      return {count:Number(r.count)||0,next:Number(r.next)||0,day:dayKey};
    };
    const locked=available.filter(o=>statusText(o).count>=3 || statusText(o).next>now);
    if(available.length && locked.length===available.length){
      const soon=Math.min(...locked.map(o=>Math.max(0,(statusText(o).next-now)/60000)).filter(x=>x>0));
      container.innerHTML='<div class="empty-note"> Все турнирные попытки на сегодня использованы.<br><span style="font-size:10px;">Новые попытки появятся завтра'+(Number.isFinite(soon)?' или после восстановления кулдауна.':'')+'</span></div>';
      return;
    }
  }
  let pool=available.filter(o=>!history.slice(-3).includes(String(o.id)));
  if(state.duelSub==='tour'){
    const now=Date.now(), dayKey=new Date().toISOString().slice(0,10);
    pool=available.filter(o=>{
      const r=state.tournamentRuns[String(o.id)]||{};
      const count=r.day===dayKey?(Number(r.count)||0):0;
      const next=r.day===dayKey?(Number(r.next)||0):0;
      return count<3 && next<=now;
    });
  }
  if(pool.length<3 && state.duelSub!=='tour') pool=available;
  pool=pool.slice().sort(()=>Math.random()-.5).slice(0,Math.min(5,pool.length));
  if(!pool.length){ container.innerHTML='<div class="empty-note">Пока нет доступных соперников.</div>'; return; }
  const routeNames=['Промзона','Ночной проспект','Портовый обход','Тоннель','Старая эстакада'];
  const route=routeNames[Math.floor(Math.random()*routeNames.length)];
  container.innerHTML='<div class="race-event-badge"><span>СЕГОДНЯ НА ЛИНИИ</span><b>'+route+'</b></div>';
  pool.forEach((opp,idx)=>{
    const winChance=Math.max(5,Math.min(95,Math.round(50+(myPower-opp.power)/Math.max(opp.power,1)*100)));
    const fee=entryFeeFor(opp);
    const recent=history.includes(String(opp.id));
    const tourStatus=state.duelSub==='tour' ? (state.tournamentRuns[String(opp.id)]||{}) : null;
    const dayKey=new Date().toISOString().slice(0,10);
    const tourCount=state.duelSub==='tour' && tourStatus && tourStatus.day===dayKey ? (Number(tourStatus.count)||0) : 0;
    const tourRewardMult=state.duelSub==='tour' ? ([1,.72,.48][Math.min(2,tourCount)]||.48) : 1;
    const shownReward=Math.round(opp.reward*tourRewardMult);
    const buttonDisabled=state.duelSub==='tour' && tourCount>=3;
    container.innerHTML += '<div class="opp-card '+(opp.boss?'boss ':'')+'roulette-choice" style="animation-delay:'+idx*70+'ms">'+
      '<div class="opp-scan"></div>'+
      '<div class="opp-head"><span class="opp-name">'+(opp.boss?' ':'')+escapeHtml(opp.name)+'</span><span class="opp-power">'+opp.power+' л.с.</span></div>'+
      (opp.boss?'<div class="boss-badge" style="position:static;display:inline-block;width:fit-content;">БОСС</div>':'')+
      '<div style="font-size:11.5px;color:var(--text-muted);font-style:italic;">'+escapeHtml(opp.taunt)+'</div>'+
      '<div class="odds-bar-bg"><div class="odds-win" style="width:'+winChance+'%"></div><div class="odds-lose" style="width:'+(100-winChance)+'%"></div></div>'+
      '<div class="opp-foot"><span>Победа: <b style="color:var(--green)">'+winChance+'%</b></span><span>Вход: <b>-'+fmt(fee)+'</b></span><span>Приз: <b>+'+fmt(shownReward)+'</b></span></div>'+
      (state.duelSub==='tour'?'<div style="font-size:10px;color:var(--gold);text-align:center;">Турнир: попытка '+(tourCount+1)+'/3 · выплата ×'+tourRewardMult.toFixed(2)+'</div>':'')+
      '<button class="btn btn-select" '+(buttonDisabled?'disabled':'')+' onclick="prepareRace(\''+String(opp.id).replace(/'/g,"\\'")+'\', \''+(state.duelSub==='tour'?'tour':'normal')+'\')">ВЫЕХАТЬ</button>'+
      (recent?'<div style="font-size:9px;color:var(--text-muted);text-align:center;">Недавняя встреча</div>':'')+
    '</div>';
  });
}


function renderJobs(){
  updateHeader();
  const container=document.getElementById('jobs-list');
  container.innerHTML='';
  const now=Date.now();
  jobsDB.forEach(job=>{
    const readyAt = state.jobCooldowns[job.id] || 0;
    const remaining = Math.max(0, Math.ceil((readyAt-now)/1000));
    const ready = remaining<=0;
    container.innerHTML += '<div class="job-card">'+
        '<div class="job-head"><span class="job-name">'+job.name+'</span><span class="job-reward">+'+fmt(job.reward)+' </span></div>'+
        '<div class="job-desc">'+job.desc+'</div>'+
        '<button class="job-btn" id="job-btn-'+job.id+'" onclick="doJob(\''+job.id+'\')" '+(ready?'':'disabled')+'>'+(ready ? 'ВЫПОЛНИТЬ' : 'Отдых: '+remaining+'с')+'</button>'+
      '</div>';
  });
}
function doJob(jobId){
  const job=jobsDB.find(j=>j.id===jobId),now=Date.now(); if(!job)return;
  const readyAt=state.jobCooldowns[jobId]||0;if(now<readyAt)return;
  awardMoney(job.reward,job.name);addXP(job.xp||5);state.jobCooldowns[jobId]=now+job.cooldown*1000;
  if(jobId==='wash') reduceHeat(1); recordContractEvent('job',1); haptic('success');
  showToast(' '+job.name+': +'+fmt(job.reward)+' SYND');updateHeader();renderJobs();saveState();
}
setInterval(()=>{
  if(document.getElementById('screen-jobs').classList.contains('active')) renderJobs();
},1000);

/* ==================== CASINO HUB ==================== */
function renderCasinoHub(){
  updateHeader();
  const c = document.getElementById('casino-hub-list');
  const stats=document.getElementById('casino-session-stats');
  const wagered=Number(state.stats.casinoWagered)||0,won=Number(state.stats.casinoWon)||0;
  if(stats) stats.innerHTML='<div><span>Поставлено</span><b>'+fmt(wagered)+' SYND</b></div><div><span>Выиграно</span><b>'+fmt(won)+' SYND</b></div><div><span>Результат</span><b class="'+(won-wagered>=0?'positive':'')+'">'+(won-wagered>=0?'+':'')+fmt(won-wagered)+' SYND</b></div>';
  if(!c)return;
  c.innerHTML =
    '<button class="casino-card casino-card-premium" onclick="switchTab(\'blackjack\')"><div class="casino-card-index">01</div><div class="casino-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="12" height="17" rx="2"/><rect x="10" y="2" width="12" height="17" rx="2"/></svg></div><div class="casino-info"><b>Блэкджек 21</b><span>Классический стол · дилер останавливается на 17</span></div><div class="casino-card-arrow">›</div></button>'+
    '<button class="casino-card casino-card-premium" onclick="switchTab(\'roulette\')"><div class="casino-card-index">02</div><div class="casino-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/></svg></div><div class="casino-info"><b>Рулетка</b><span>Числа, цвет и чётность · быстрые ставки</span></div><div class="casino-card-arrow">›</div></button>'+
    '<button class="casino-card casino-card-premium featured" onclick="switchTab(\'slots\')"><div class="casino-card-index">03</div><div class="casino-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5M16 4v5"/></svg></div><div class="casino-info"><b>Слоты «777»</b><span>Три барабана · главный выигрыш ×50</span></div><div class="casino-card-arrow">›</div></button>'+
    '<button class="casino-card casino-card-premium" onclick="switchTab(\'dice\')"><div class="casino-card-index">04</div><div class="casino-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.3"/><circle cx="16" cy="16" r="1.3"/><circle cx="12" cy="12" r="1.3"/></svg></div><div class="casino-info"><b>Кости</b><span>Настрой вероятность и коэффициент выплаты</span></div><div class="casino-card-arrow">›</div></button>';
}

function clampBet(input, min){
  let v = parseInt(input.value)||0;
  const hardMax=ECONOMY_V12_6.casinoMax();
  if(v<min) v=min;
  if(v>hardMax) v=hardMax;
  if(v>state.coins) v=state.coins;
  input.value=v;
  return v;
}

/* ==================== BLACKJACK ==================== */
let bj = null;
let rltSpinning=false,slotsSpinning=false,diceRolling=false;
function bjAdjustBet(delta){ const i=document.getElementById('bj-bet-input'); i.value=(parseInt(i.value)||0)+delta; clampBet(i,10); }
function bjMaxBet(){ document.getElementById('bj-bet-input').value=ECONOMY_V12_6.casinoMax(); clampBet(document.getElementById('bj-bet-input'),10); }
function bjNewDeck(){
  const suits=['S','H','D','C']; const ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  let d=[];
  suits.forEach(s=>ranks.forEach(r=>d.push({r,s})));
  for(let i=d.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [d[i],d[j]]=[d[j],d[i]]; }
  return d;
}
function bjCardValue(hand){
  let total=0, aces=0;
  hand.forEach(c=>{
    if(c.r==='A'){ total+=11; aces++; }
    else if(['J','Q','K'].includes(c.r)) total+=10;
    else total+=parseInt(c.r);
  });
  while(total>21 && aces>0){ total-=10; aces--; }
  return total;
}
function bjRenderCard(c, hidden){
  if(hidden) return '<div class="card-el back"></div>';
  const red = c.s==='H'||c.s==='D';
  return '<div class="card-el '+(red?'red':'black')+'">'+c.r+'<br>'+c.s+'</div>';
}
function bjRenderHands(hideDealer){
  document.getElementById('bj-player-cards').innerHTML = bj.player.map(c=>bjRenderCard(c,false)).join('');
  document.getElementById('bj-dealer-cards').innerHTML = bj.dealer.map((c,idx)=>bjRenderCard(c, hideDealer && idx===1)).join('');
  document.getElementById('bj-player-score').innerText = bjCardValue(bj.player);
  document.getElementById('bj-dealer-score').innerText = hideDealer ? '?' : bjCardValue(bj.dealer);
}
function bjDeal(){
  if(bj && !bj.done)return;
  const bet = clampBet(document.getElementById('bj-bet-input'),10);
  if(bet>state.coins || bet<10){ showToast("Некорректная ставка"); return; }
  state.coins-=bet; state.stats.casinoWagered+=bet; updateHeader();
  const deck=bjNewDeck();
  bj = { deck, bet, player:[deck.pop(),deck.pop()], dealer:[deck.pop(),deck.pop()], done:false, doubled:false };
  document.getElementById('bj-message').innerText='';
  document.getElementById('bj-bet-panel').style.display='none';
  const ap=document.getElementById('bj-action-panel');
  ap.style.display='flex';
  const canDouble = state.coins>=bet;
  ap.innerHTML = '<button class="btn btn-select" onclick="bjHit()">ЕЩЁ</button>'+
    '<button class="btn btn-ghost" onclick="bjStand()">ХВАТИТ</button>'+
    '<button class="btn btn-gold" '+(canDouble?'':'disabled')+' onclick="bjDouble()">УДВОИТЬ</button>';
  bjRenderHands(true);
  if(bjCardValue(bj.player)===21){ bjStand(); }
}
function bjHit(){
  if(bj.done) return;
  bj.player.push(bj.deck.pop());
  bjRenderHands(true);
  if(bjCardValue(bj.player)>21){ bjEnd('bust'); }
  else if(bjCardValue(bj.player)===21){ bjStand(); }
}
function bjDouble(){
  if(bj.done || state.coins<bj.bet) return;
  state.coins-=bj.bet; state.stats.casinoWagered+=bj.bet; updateHeader();
  bj.bet*=2; bj.doubled=true;
  bj.player.push(bj.deck.pop());
  bjRenderHands(true);
  if(bjCardValue(bj.player)>21){ bjEnd('bust'); } else { bjStand(); }
}
function bjStand(){
  if(bj.done) return;
  while(bjCardValue(bj.dealer)<17){ bj.dealer.push(bj.deck.pop()); }
  bjRenderHands(false);
  const p=bjCardValue(bj.player), d=bjCardValue(bj.dealer);
  if(d>21 || p>d) bjEnd('win');
  else if(p===d) bjEnd('push');
  else bjEnd('lose');
}
function bjEnd(result){
  bj.done=true;
  bjRenderHands(false);
  const msg=document.getElementById('bj-message');
  const isBlackjack = bj.player.length===2 && bjCardValue(bj.player)===21;
  let payout=0, text='';
  if(result==='win' || result==='bust'){
    if(result==='bust'){ text=' ПЕРЕБОР — вы проиграли'; msg.style.color='var(--accent)'; payout=0; }
    else {
      state.stats.blackjackWins=(state.stats.blackjackWins||0)+1;
      payout = isBlackjack ? Math.round(bj.bet*2.5) : bj.bet*2;
      text = isBlackjack ? ' БЛЭКДЖЕК! +'+fmt(payout-bj.bet)+' ' : ' ПОБЕДА! +'+fmt(payout-bj.bet)+' ';
      msg.style.color='var(--green)';
    }
  } else if(result==='push'){ payout=bj.bet; text=' НИЧЬЯ — ставка возвращена'; msg.style.color='var(--text-muted)'; }
  else { text=' ДИЛЕР СИЛЬНЕЕ — вы проиграли'; msg.style.color='var(--accent)'; payout=0; }
  msg.innerText=text;
  if(payout>0){ state.coins+=payout; state.stats.casinoWon+=Math.max(0,payout-bj.bet); }
  updateHeader();
  flashResult(document.querySelector('#screen-blackjack .game-table'), payout>bj.bet || payout===bj.bet);
  document.getElementById('bj-action-panel').style.display='none';
  document.getElementById('bj-bet-panel').style.display='block';
  saveState(); checkAchievements();
}

/* ==================== ROULETTE ==================== */
const RLT_RED = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
let rltSelection = null;
function rltAdjustBet(delta){ const i=document.getElementById('rlt-bet-input'); i.value=(parseInt(i.value)||0)+delta; clampBet(i,10); }
function rltMaxBet(){ document.getElementById('rlt-bet-input').value=ECONOMY_V12_6.casinoMax(); clampBet(document.getElementById('rlt-bet-input'),10); }
function rltInit(){
  const grid=document.getElementById('rlt-grid');
  let html='';
  for(let n=0;n<=36;n++){
    const color = n===0?'green':(RLT_RED.includes(n)?'red':'black');
    html += '<div class="rlt-num '+color+'" onclick="rltSelectNumber('+n+')" id="rlt-n-'+n+'">'+n+'</div>';
  }
  grid.innerHTML=html;
  const outside=document.getElementById('rlt-outside');
  outside.innerHTML = ['red:Красное','black:Чёрное','even:Чёт','odd:Нечёт','low:1-18','high:19-36'].map(x=>{
    const [key,label]=x.split(':');
    return '<div onclick="rltSelectOutside(\''+key+'\')" id="rlt-o-'+key+'">'+label+'</div>';
  }).join('');
}
function rltClearSelection(){
  document.querySelectorAll('.rlt-num').forEach(e=>e.classList.remove('selected'));
  document.querySelectorAll('.rlt-outside div').forEach(e=>e.classList.remove('selected'));
}
function rltSelectNumber(n){ rltClearSelection(); rltSelection={type:'number', value:n}; document.getElementById('rlt-n-'+n).classList.add('selected'); }
function rltSelectOutside(key){ rltClearSelection(); rltSelection={type:'outside', value:key}; document.getElementById('rlt-o-'+key).classList.add('selected'); }
function rltSpin(){
  if(rltSpinning)return;
  if(!rltSelection){ showToast("Выберите ставку: число, цвет или диапазон"); return; }
  const bet = clampBet(document.getElementById('rlt-bet-input'),10);
  if(bet>state.coins || bet<10){ showToast("Некорректная ставка"); return; }
  state.coins-=bet; state.stats.casinoWagered+=bet; updateHeader();rltSpinning=true;
  const resEl=document.getElementById('rlt-result');
  resEl.style.background='#1a1a24'; resEl.innerText='...';
  setTimeout(()=>{
    const n = Math.floor(Math.random()*37);
    const color = n===0?'green':(RLT_RED.includes(n)?'red':'black');
    resEl.innerText=n;
    resEl.style.background = color==='green'?'var(--green)':(color==='red'?'#b91c1c':'#1a1a24');
    let win=false, mult=0;
    if(rltSelection.type==='number' && rltSelection.value===n){ win=true; mult=35; }
    else if(rltSelection.type==='outside'){
      if(rltSelection.value==='red' && color==='red'){ win=true; mult=1; }
      else if(rltSelection.value==='black' && color==='black'){ win=true; mult=1; }
      else if(rltSelection.value==='even' && n!==0 && n%2===0){ win=true; mult=1; }
      else if(rltSelection.value==='odd' && n%2===1){ win=true; mult=1; }
      else if(rltSelection.value==='low' && n>=1 && n<=18){ win=true; mult=1; }
      else if(rltSelection.value==='high' && n>=19 && n<=36){ win=true; mult=1; }
    }
    const table = document.querySelector('#screen-roulette');
    if(win){
      const payout = bet + bet*mult;
      state.coins+=payout; state.stats.casinoWon += payout-bet;
      showToast(" Выигрыш! +"+fmt(payout-bet)+" ");
      flashResult(table, true);
    } else {
      showToast(" Не повезло. Число: "+n);
      flashResult(table, false);
    }
    rltSpinning=false;updateHeader(); saveState(); checkAchievements();
  }, 900);
}

/* ==================== SLOTS ==================== */
const SLOT_SYMBOLS = ['BOLT','DIAMOND','STAR','CROWN','BAR','777'];
const SLOT_WEIGHTS = [30,26,20,13,8,3];
function slotsAdjustBet(delta){ const i=document.getElementById('slots-bet-input'); i.value=(parseInt(i.value)||0)+delta; clampBet(i,10); }
function slotsMaxBet(){ document.getElementById('slots-bet-input').value=ECONOMY_V12_6.casinoMax(); clampBet(document.getElementById('slots-bet-input'),10); }
function weightedSymbol(){
  const total = SLOT_WEIGHTS.reduce((a,b)=>a+b,0);
  let r=Math.random()*total;
  for(let i=0;i<SLOT_SYMBOLS.length;i++){ if(r<SLOT_WEIGHTS[i]) return SLOT_SYMBOLS[i]; r-=SLOT_WEIGHTS[i]; }
  return SLOT_SYMBOLS[0];
}
const SLOT_PAYOUTS = {BOLT:3,DIAMOND:4,STAR:6,CROWN:10,BAR:20,'777':50};
function slotsSpin(){
  if(slotsSpinning)return;
  const bet = clampBet(document.getElementById('slots-bet-input'),10);
  if(bet>state.coins || bet<10){ showToast("Некорректная ставка"); return; }
  state.coins-=bet; state.stats.casinoWagered+=bet; updateHeader();slotsSpinning=true;
  const reels=[document.getElementById('reel0'),document.getElementById('reel1'),document.getElementById('reel2')];
  reels.forEach(r=>r.classList.add('spin'));
  document.getElementById('slots-message').innerText='';
  let ticks=0;
  const iv=setInterval(()=>{
    reels.forEach(r=>r.innerText=weightedSymbol());
    ticks++;
    if(ticks>12){
      clearInterval(iv);
      const final=[weightedSymbol(),weightedSymbol(),weightedSymbol()];
      reels.forEach((r,i)=>{ r.innerText=final[i]; r.classList.remove('spin'); });
      let payout=0, msg='';
      if(final[0]===final[1] && final[1]===final[2]){
        payout = bet*SLOT_PAYOUTS[final[0]];
        msg = ' ДЖЕКПОТ! '+final[0]+final[0]+final[0]+' — x'+SLOT_PAYOUTS[final[0]];
      } else if(final[0]===final[1] || final[1]===final[2] || final[0]===final[2]){
        payout = Math.round(bet*1.5);
        msg = ' Пара совпала — небольшой выигрыш';
      } else { msg='Не повезло, крутите ещё'; }
      const table=document.querySelector('#screen-slots');
      if(payout>0){ state.coins+=payout; state.stats.casinoWon+=payout-bet; flashResult(table,true); }
      else { flashResult(table,false); }
      document.getElementById('slots-message').innerText=msg;
      document.getElementById('slots-message').style.color = payout>0?'var(--green)':'var(--text-muted)';
      slotsSpinning=false;updateHeader(); saveState(); checkAchievements();
    }
  },80);
}

/* ==================== DICE ==================== */
function diceUpdate(){
  const target = parseInt(document.getElementById('dice-slider').value);
  document.getElementById('dice-target').innerText = target;
  const chance = target-1;
  const mult = (97/chance).toFixed(2);
  document.getElementById('dice-chance').innerText = chance+'%';
  document.getElementById('dice-mult').innerText = 'x'+mult;
}
function diceAdjustBet(delta){ const i=document.getElementById('dice-bet-input'); i.value=(parseInt(i.value)||0)+delta; clampBet(i,10); }
function diceMaxBet(){ document.getElementById('dice-bet-input').value=ECONOMY_V12_6.casinoMax(); clampBet(document.getElementById('dice-bet-input'),10); }
function diceRoll(){
  if(diceRolling)return;
  const bet = clampBet(document.getElementById('dice-bet-input'),10);
  if(bet>state.coins || bet<10){ showToast("Некорректная ставка"); return; }
  const target = parseInt(document.getElementById('dice-slider').value);
  state.coins-=bet; state.stats.casinoWagered+=bet; updateHeader();diceRolling=true;
  const resEl=document.getElementById('dice-result');
  resEl.innerText='...'; resEl.style.color='var(--text-muted)';
  setTimeout(()=>{
    const roll = Math.floor(Math.random()*100)+1;
    resEl.innerText=roll;
    const win = roll<target;
    const table=document.querySelector('#screen-dice');
    if(win){
      const mult = 97/(target-1);
      const payout = Math.round(bet*mult);
      state.coins+=payout; state.stats.casinoWon+=payout-bet;
      resEl.style.color='var(--green)';
      showToast(" Выигрыш! +"+fmt(payout-bet)+" ");
      flashResult(table,true);
    } else {
      resEl.style.color='var(--accent)';
      showToast(" Мимо. Выпало: "+roll);
      flashResult(table,false);
    }
    diceRolling=false;updateHeader(); saveState(); checkAchievements();
  }, 500);
}

/* ==================== ACHIEVEMENTS ==================== */
const achievementsDB = [
  { id:'first_win', name:'Первая кровь', desc:'Выиграй свою первую дуэль', icon:'', reward:100, check:s=>s.stats.wins>=1 },
  { id:'ten_wins', name:'Ветеран трассы', desc:'Одержи 10 побед', icon:'', reward:500, check:s=>s.stats.wins>=10 },
  { id:'five_cars', name:'Коллекционер', desc:'Владей 5 машинами одновременно', icon:'', reward:400, check:s=>s.ownedCars.length>=5 },
  { id:'all_cars', name:'Весь гараж синдиката', desc:'Собери все машины в игре', icon:'', reward:5000, check:s=>s.ownedCars.length>=27 },
  { id:'lvl10', name:'Авторитет района', desc:'Достигни 10 уровня', icon:'⭐', reward:600, check:s=>s.level>=10 },
  { id:'first_fine', name:'Знакомство с ДПС', desc:'Получи первый штраф от полиции', icon:'', reward:50, check:s=>s.stats.finesCount>=1 },
  { id:'bj_win', name:'Карточный игрок', desc:'Выиграй раунд в блэкджек', icon:'', reward:150, check:s=>(s.stats.blackjackWins||0)>=1 },
  { id:'max_tune', name:'Гараж мечты', desc:'Прокачай тюнинг любой машины до максимума во всех категориях', icon:'', reward:800, check:s=>Object.values(s.upgrades).some(u=>u && TUNE_TYPES.every(t=>u[t.key]>=t.hpPerStage.length)) },
  { id:'earn50k', name:'Барон подполья', desc:'Заработай суммарно 50 000 ', icon:'', reward:1000, check:s=>s.stats.totalEarned>=50000 },
  { id:'daily7', name:'Верный синдикату', desc:'Забирай ежедневную награду 7 дней подряд', icon:'', reward:700, check:s=>s.dailyStreak>=7 },
  { id:'secret_car', name:'Тень подполья', desc:'Стань владельцем мифической машины', icon:'', reward:1500, check:s=>s.ownedCars.includes(26)||s.ownedCars.includes(27) },
  { id:'boss_slayer', name:'Убийца боссов', desc:'Победи одного из боссов подполья', icon:'', reward:2000, check:s=>(s.stats.bossWins||0)>=1 }
];
function checkAchievements(){
  let any=false;
  achievementsDB.forEach(a=>{
    if(state.achievements[a.id]) return;
    let passed=false;
    try{ passed = a.check(state); }catch(e){ passed=false; }
    if(passed){
      state.achievements[a.id]=true;
      state.coins += a.reward;
      showToast(' Достижение: '+a.name+' (+'+fmt(a.reward)+' )');
      any=true;
    }
  });
  if(any){ updateHeader(); saveState(); }
  const sub=document.getElementById('ach-progress-sub');
  if(sub) sub.innerText = Object.keys(state.achievements).length+'/'+achievementsDB.length;
}
function renderAchievements(){
  const c=document.getElementById('ach-list');
  c.innerHTML='';
  achievementsDB.forEach(a=>{
    const done = !!state.achievements[a.id];
    c.innerHTML += '<div class="ach-card '+(done?'done':'')+'">'+
      '<div class="ach-ic">'+a.icon+'</div>'+
      '<div class="ach-body"><b>'+a.name+'</b><span>'+a.desc+'</span></div>'+
      '<div class="ach-reward">'+(done?'':'+'+fmt(a.reward))+'</div>'+
    '</div>';
  });
}

/* ==================== CASES ==================== */
const casesDB = [
  { id:'bronze', name:'Бронзовый кейс', icon:'', price:300, desc:'Немного монет или заряд нитро' },
  { id:'silver', name:'Серебряный кейс', icon:'', price:1200, desc:'Хорошая пачка денег и шанс на нитро' },
  { id:'gold', name:'Золотой кейс', icon:'', price:4000, desc:'Крупный куш и редкий шанс на мифическую машину' }
];
function renderCases(){
  const c=document.getElementById('cases-list');
  c.innerHTML='';
  casesDB.forEach(cs=>{
    c.innerHTML += '<div class="case-card"><div class="case-ic">'+cs.icon+'</div><div class="case-name">'+cs.name+'</div><div class="case-desc">'+cs.desc+'</div>'+
      '<button class="btn btn-gold" '+(state.coins<cs.price?'disabled':'')+' onclick="openCase(\''+cs.id+'\')">ОТКРЫТЬ ЗА '+fmt(cs.price)+' </button></div>';
  });
}
function openCase(caseId){
  const cs = casesDB.find(c=>c.id===caseId);
  if(state.coins<cs.price){ showToast("Недостаточно денег"); return; }
  state.coins-=cs.price; state.stats.totalSpent+=cs.price; state.stats.casesOpened++;
  const r = Math.random();
  let resultMsg='';
  if(caseId==='bronze'){
    if(r<0.6){ const c=Math.round(cs.price*(0.5+Math.random())); state.coins+=c; resultMsg='+'+fmt(c)+' '; }
    else if(r<0.9){ state.nitro+=1; resultMsg='+1 заряд нитро '; }
    else { const c=Math.round(cs.price*2.5); state.coins+=c; resultMsg='Удача! +'+fmt(c)+' '; }
  } else if(caseId==='silver'){
    if(r<0.5){ const c=Math.round(cs.price*(0.6+Math.random())); state.coins+=c; resultMsg='+'+fmt(c)+' '; }
    else if(r<0.85){ state.nitro+=2; resultMsg='+2 заряда нитро '; }
    else { const c=Math.round(cs.price*3); state.coins+=c; resultMsg='Крупная удача! +'+fmt(c)+' '; }
  } else {
    if(r<0.45){ const c=Math.round(cs.price*(0.6+Math.random())); state.coins+=c; resultMsg='+'+fmt(c)+' '; }
    else if(r<0.8){ state.nitro+=3; resultMsg='+3 заряда нитро '; }
    else if(r<0.985){ const c=Math.round(cs.price*3.5); state.coins+=c; resultMsg='Джекпот! +'+fmt(c)+' '; }
    else {
      const secretIds=[26,27].filter(id=>!state.ownedCars.includes(id));
      if(secretIds.length>0){
        const id=secretIds[Math.floor(Math.random()*secretIds.length)];
        state.ownedCars.push(id);
        resultMsg=' ЛЕГЕНДАРНЫЙ ДРОП! Машина "'+carsDB.find(c=>c.id===id).name+'" теперь ваша!';
      } else { const c=Math.round(cs.price*5); state.coins+=c; resultMsg='Джекпот! +'+fmt(c)+' '; }
    }
  }
  showToast(' '+resultMsg);
  updateHeader(); renderCases(); saveState(); checkAchievements();
}

/* ==================== LEADERBOARD ==================== */
/* ==================== LEADERBOARD — REAL PLAYERS ==================== */
async function renderLeaderboard(){
  const c=document.getElementById('lb-list');
  if(!c)return;
  c.innerHTML='<div class="empty-note">Загрузка игроков…</div>';
  if(typeof syncPlayerProfile==='function') await syncPlayerProfile();
  const rows=typeof loadPlayerLeaderboard==='function' ? await loadPlayerLeaderboard() : [];
  if(!rows.length){
    c.innerHTML='<div class="empty-note">В рейтинге пока недостаточно данных для отображения игроков.</div>';
    return;
  }
  c.innerHTML='';
  rows.forEach((r,i)=>{
    const races=Number(r.races)||0,wins=Number(r.wins)||0,wr=races?Math.round(wins/races*100):0;
    const owned=Array.isArray(r.owned_cars)?r.owned_cars:[];
    const carNames=owned.map(id=>carsDB.find(c=>String(c.id)===String(id))).filter(Boolean).map(c=>c.name);
    const me=String(r.id)===String(state.playerId);
    const rankCls=i===0?'top1':i===1?'top2':i===2?'top3':'';
    const row=document.createElement('div');
    row.className='lb-row '+(me?'me':'');
    row.onclick=()=>openPublicProfileData(r);
    row.innerHTML='<div class="lb-rank '+rankCls+'">#'+(i+1)+'</div>'+
      '<div class="lb-name">'+escapeHtml(r.name||'Гонщик')+(me?' <small style="color:var(--green)">ВЫ</small>':'')+
      '<small style="display:block;color:var(--text-muted);font-size:8px;">LVL '+(Number(r.level)||1)+' · '+wr+'% WR · '+carNames.length+' машин</small>'+
      '<div class="player-lb-cars">'+(carNames.slice(0,4).map(x=>'<span class="player-lb-car">'+escapeHtml(x)+'</span>').join('')+(carNames.length>4?'<span class="player-lb-car">+'+(carNames.length-4)+'</span>':''))+'</div></div>'+
      '<div class="lb-val">'+fmt(Number(r.balance)||0)+' <small>SYND</small></div>';
    c.appendChild(row);
  });
}



/* ==================== CARBON CAREER / HEAT / CONTRACTS 5.0 ==================== */
let garageSort='name',shopCategory='all',shopSort='price';
const DISTRICTS=[
  {id:'downtown',name:'Даунтаун',unlockLevel:1,target:0,next:350,desc:'Плотный трафик, короткие прямые и первые серьёзные вызовы.'},
  {id:'industrial',name:'Промзона',unlockLevel:4,target:350,next:1200,desc:'Широкие дороги, портовые развязки и быстрые машины.'},
  {id:'canyon',name:'Каньон',unlockLevel:8,target:1200,next:3000,desc:'Ошибка стоит дорого. Здесь репутация решает больше мощности.'},
  {id:'silverton',name:'Сильвертон',unlockLevel:13,target:3000,next:6000,desc:'Финальный район синдиката: боссы, высокий HEAT и большие ставки.'}
];
const CONTRACT_POOL=[
  {id:'races3',event:'race',target:3,reward:120,name:'На линии',desc:'Заверши 3 уличных заезда.'},
  {id:'wins2',event:'win',target:2,reward:160,name:'Без права на ошибку',desc:'Выиграй 2 заезда.'},
  {id:'shift4',event:'perfectShift',target:4,reward:140,name:'Идеальная КПП',desc:'Сделай 4 идеальных переключения.'},
  {id:'job2',event:'job',target:2,reward:100,name:'Запасной план',desc:'Выполни 2 подработки.'},
  {id:'nitro1',event:'nitro',target:1,reward:120,name:'На полном баллоне',desc:'Используй нитро в заезде.'},
  {id:'buy1',event:'buy',target:1,reward:150,name:'Расширение гаража',desc:'Купи одну машину.'}
];
function haptic(type='light'){
  if(!state.settings?.haptics)return;
  try{const h=window.Telegram?.WebApp?.HapticFeedback;if(!h)return;if(type==='success'||type==='error'||type==='warning')h.notificationOccurred(type);else h.impactOccurred(type==='heavy'?'heavy':type==='medium'?'medium':'light');}catch(_){ }
}
function renderGarageTools(){
  const active=carsDB.find(c=>c.id===state.activeCarId),q=document.getElementById('garage-quick-service'),tb=document.getElementById('garage-toolbar');if(!active||!q||!tb)return;
  const fuel=getFuel(active.id),cond=getCondition(active.id);
  q.innerHTML='<div class="quick-service-card" onclick="quickRefuelActive()"><span>Быстрый сервис · топливо</span><b> '+fuel+'% · до полного</b></div><div class="quick-service-card" onclick="quickRepairActive()"><span>Быстрый сервис · состояние</span><b> '+cond+'% · ремонт</b></div>';
  tb.innerHTML=['name','power','condition'].map(k=>'<button class="carbon-chip '+(garageSort===k?'active':'')+'" onclick="setGarageSort(\''+k+'\')">'+({name:'ПО НАЗВАНИЮ',power:'МОЩНОСТЬ',condition:'СОСТОЯНИЕ'}[k])+'</button>').join('');
}
function setGarageSort(v){garageSort=['name','power','condition'].includes(v)?v:'name';renderGarage();}
function quickRefuelActive(){const car=carsDB.find(c=>c.id===state.activeCarId);if(car)refuelCar(car.id);}
function quickRepairActive(){const car=carsDB.find(c=>c.id===state.activeCarId);if(car)repairCar(car.id);}
function renderShopToolbar(){
  const tb=document.getElementById('shop-toolbar');if(!tb)return;const cats=[['all','ВСЕ'],['street','STREET'],['jdm','JDM'],['muscle','MUSCLE'],['sport','SPORT'],['super','SUPER'],['hyper','HYPER'],['legend','БОСС']];
  tb.innerHTML=cats.map(([k,n])=>'<button class="carbon-chip '+(shopCategory===k?'active':'')+'" onclick="setShopCategory(\''+k+'\')">'+n+'</button>').join('')+'<button class="carbon-chip '+(shopSort==='power'?'active':'')+'" onclick="toggleShopSort()">'+(shopSort==='power'?'↓ МОЩНОСТЬ':'↑ ЦЕНА')+'</button>';
}
function setShopCategory(v){shopCategory=v;renderShop();}function toggleShopSort(){shopSort=shopSort==='price'?'power':'price';renderShop();}
function addHeat(n=1){state.heat=Math.max(0,Math.min(5,(Number(state.heat)||0)+n));}
function reduceHeat(n=1){state.heat=Math.max(0,(Number(state.heat)||0)-n);}
function heatLabel(){return ['ЧИСТО','ЗАМЕЧЕН','В РОЗЫСКЕ','ГОРЯЧО','ОБЛАВА','МАКС. РОЗЫСК'][state.heat]||'ЧИСТО';}
function renderHeatStrip(id){const el=document.getElementById(id);if(!el)return;el.innerHTML='<div class="heat-head"><span>POLICE HEAT · '+heatLabel()+'</span><b>'+state.heat+'/5</b></div><div class="heat-bars">'+[1,2,3,4,5].map(i=>'<i class="'+(i<=state.heat?'on':'')+'"></i>').join('')+'</div>';}
function dayKeyLocal(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function hashDay(s){let h=2166136261;for(const ch of s){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function getActiveContracts(){const day=dayKeyLocal(),seed=hashDay(day);return CONTRACT_POOL.slice().sort((a,b)=>((hashDay(a.id)^seed)-(hashDay(b.id)^seed))).slice(0,3);}
function ensureContracts(){const day=dayKeyLocal();if(state.contracts?.day!==day)state.contracts={day,items:{}};if(!state.contracts.items||typeof state.contracts.items!=='object')state.contracts.items={};}
function contractStatus(c){ensureContracts();const row=state.contracts.items[c.id]||{};const progress=Math.min(c.target,Math.max(0,Number(row.progress)||0));return{progress,done:progress>=c.target,claimed:row.claimed===true};}
function recordContractEvent(event,amount=1){ensureContracts();let changed=false;getActiveContracts().filter(c=>c.event===event).forEach(c=>{const row=state.contracts.items[c.id]||{progress:0,claimed:false};if(row.claimed)return;row.progress=Math.min(c.target,(Number(row.progress)||0)+Math.max(0,Number(amount)||0));state.contracts.items[c.id]=row;changed=true;});if(changed)saveState();}
function renderContracts(){ensureContracts();const c=document.getElementById('contract-list');if(!c)return;const now=new Date(),next=new Date(now);next.setHours(24,0,0,0);document.getElementById('contract-reset-label').innerText='Сброс через '+Math.max(1,Math.ceil((next-now)/3600000))+' ч';c.innerHTML='';getActiveContracts().forEach(x=>{const st=contractStatus(x),pct=Math.round(st.progress/x.target*100);c.innerHTML+='<div class="contract-card"><div class="contract-top"><div class="contract-name">'+x.name+'</div><div class="contract-reward">+'+fmt(x.reward)+' SYND</div></div><div class="contract-desc">'+x.desc+'</div><div class="contract-progress"><i style="width:'+pct+'%"></i></div><div class="contract-foot"><span>'+st.progress+' / '+x.target+'</span><span>'+(st.claimed?'ПОЛУЧЕНО':st.done?'ГОТОВО':'В ПРОЦЕССЕ')+'</span></div>'+(st.done&&!st.claimed?'<button class="btn btn-select" style="margin-top:9px;" onclick="claimContract(\''+x.id+'\')">ЗАБРАТЬ НАГРАДУ</button>':'')+'</div>';});}
function claimContract(id){ensureContracts();const c=getActiveContracts().find(x=>x.id===id);if(!c)return;const st=contractStatus(c);if(!st.done||st.claimed)return;state.contracts.items[id].claimed=true;awardMoney(c.reward,'КОНТРАКТ · '+c.name);haptic('success');saveState();renderContracts();}
function currentDistrict(){let d=DISTRICTS[0];for(const x of DISTRICTS)if(state.level>=x.unlockLevel)d=x;return d;}
function recordCareerRace(won,opp){recordContractEvent('race',1);if(won){recordContractEvent('win',1);const gain=Math.max(18,Math.min(180,Math.round((Number(opp?.power)||200)/8)));state.districtRep=(state.districtRep||0)+gain;const d=currentDistrict();state.districtWins[d.id]=(Number(state.districtWins[d.id])||0)+1;addHeat(1);}else if(state.heat>0&&Math.random()<.28)reduceHeat(1);saveState();}
function renderDistricts(){renderHeatStrip('district-heat');const c=document.getElementById('district-grid');if(!c)return;document.getElementById('district-rep-label').innerText=fmt(state.districtRep)+' REP';c.innerHTML='';DISTRICTS.forEach(d=>{const locked=state.level<d.unlockLevel,pct=d.next<=d.target?100:Math.max(0,Math.min(100,(state.districtRep-d.target)/(d.next-d.target)*100));const wins=Number(state.districtWins[d.id])||0;c.innerHTML+='<div class="district-card '+(locked?'locked':'')+'"><div class="district-kicker">'+(locked?'LOCKED · LVL '+d.unlockLevel:'TERRITORY // '+d.id.toUpperCase())+'</div><h3>'+d.name+'</h3><div class="district-desc">'+d.desc+'</div><div class="district-progress"><i style="width:'+pct+'%"></i></div><div class="district-meta"><span>'+Math.round(pct)+'% КОНТРОЛЯ</span><span>'+wins+' ПОБЕД</span></div></div>';});}
function recordRaceTelemetry(payload){if(!payload)return;state.recentRaces=Array.isArray(state.recentRaces)?state.recentRaces:[];state.recentRaces.push(payload);state.recentRaces=state.recentRaces.slice(-12);}
function renderRecentRaceSummary(){const root=document.getElementById('recent-race-summary');if(!root)return;const r=state.recentRaces?.[state.recentRaces.length-1];if(!r){root.innerHTML='';return;}root.innerHTML='<div class="contract-card"><div class="contract-top"><div class="contract-name">Последний заезд · '+escapeHtml(r.route)+'</div><div class="contract-reward" style="color:'+(r.won?'var(--green)':'var(--danger)')+'">'+(r.won?'ПОБЕДА':'ПОРАЖЕНИЕ')+'</div></div><div class="contract-desc">'+escapeHtml(r.opponent)+' · '+Number(r.time).toFixed(2)+' c · '+Math.round(r.topSpeed)+' км/ч · идеальных SHIFT: '+r.perfectShifts+(r.nitroUsed?' · NITRO':'')+'</div></div>';}
/* ==================== SETTINGS ==================== */
function renderSettings(){
  const map={sound:'set-sound',animations:'set-anim',haptics:'set-haptics',reducedMotion:'set-reduced-motion',compactHud:'set-compact-hud'};
  Object.entries(map).forEach(([key,id])=>document.getElementById(id)?.classList.toggle('on',!!state.settings[key]));
  const el=document.getElementById('last-saved-text');if(el)el.innerText=state.lastSaved?new Date(state.lastSaved).toLocaleTimeString('ru-RU'):'—';
}
function toggleSetting(key){
  if(!(key in state.settings))return;state.settings[key]=!state.settings[key];applyUiSettings();haptic('light');renderSettings();saveState();
}

/* ==================== DAILY REWARD ==================== */
const DAILY_REWARDS = [120,160,220,300,400,550,800];
function checkDailyEligible(){
  const now=Date.now();
  const hours = (now-state.lastDailyClaim)/3600000;
  return state.lastDailyClaim===0 || hours>=20;
}
function openDailyModal(force){
  if(!force && !checkDailyEligible()) return;
  const now=Date.now();
  const hours = (now-state.lastDailyClaim)/3600000;
  const eligible = state.lastDailyClaim===0 || hours>=20;
  const missedStreak = state.lastDailyClaim!==0 && hours>48;
  const dayIndex = missedStreak ? 0 : (state.dailyStreak % 7);
  let strip='';
  for(let i=0;i<7;i++){
    const claimed = i<dayIndex;
    const today = i===dayIndex;
    strip += '<div class="daily-day '+(claimed?'claimed':'')+' '+(today?'today':'')+'">Д'+(i+1)+'<br>'+DAILY_REWARDS[i]+'</div>';
  }
  const root=document.getElementById('daily-modal-root');
  root.innerHTML = '<div class="modal-overlay" id="daily-overlay"><div class="modal-box">'+
    '<div style="font-size:40px;"></div>'+
    '<div style="font-size:17px;font-weight:900;margin:8px 0;">Ежедневная награда</div>'+
    '<div style="color:var(--text-muted);font-size:12px;font-weight:700;">День '+(dayIndex+1)+' из 7</div>'+
    '<div class="daily-strip">'+strip+'</div>'+
    (eligible ? '<button class="btn btn-gold" onclick="claimDaily('+dayIndex+')">ЗАБРАТЬ +'+fmt(DAILY_REWARDS[dayIndex])+' </button>'
              : '<div style="color:var(--text-muted);font-size:12px;font-weight:700;margin-bottom:8px;">Уже забрано сегодня — заходи позже</div>')+
    '<button class="btn btn-ghost" style="margin-top:8px;" onclick="closeDailyModal()">Закрыть</button>'+
  '</div></div>';
}
function claimDaily(dayIndex){
  const now=Date.now();
  const hours = (now-state.lastDailyClaim)/3600000;
  const missedStreak = state.lastDailyClaim!==0 && hours>48;
  state.dailyStreak = missedStreak ? 1 : state.dailyStreak+1;
  awardMoney(DAILY_REWARDS[dayIndex],'ЕЖЕДНЕВНАЯ НАГРАДА');
  state.lastDailyClaim = now;
  showToast(' Награда дня: +'+fmt(DAILY_REWARDS[dayIndex])+' ');
  updateHeader(); closeDailyModal(); saveState(); checkAchievements();
  const sub=document.getElementById('daily-hub-sub'); if(sub) sub.innerText='Уже забрано';
}
function closeDailyModal(){ document.getElementById('daily-modal-root').innerHTML=''; }

/* ==================== PROFILE ==================== */
function renderProfile(){
  updateHeader();updateAvatarUI();ensureContracts();
  document.getElementById('profile-name').innerText=state.playerName;document.getElementById('profile-lvl').innerText=state.level;document.getElementById('p-balance').innerText=fmt(state.coins);document.getElementById('p-cars').innerText=state.ownedCars.length;document.getElementById('p-races').innerText=state.stats.races;
  const wr=state.stats.races>0?Math.round(state.stats.wins/state.stats.races*100):0;document.getElementById('p-winrate').innerText=wr+'%';document.getElementById('p-wins').innerText=state.stats.wins;document.getElementById('p-losses').innerText=state.stats.losses;document.getElementById('p-earned').innerText=fmt(state.stats.totalEarned);document.getElementById('p-fines').innerText=state.stats.finesCount;
  const need=xpNeeded(state.level);document.getElementById('xp-text').innerText=state.xp+'/'+need;document.getElementById('xp-fill').style.width=Math.round(state.xp/need*100)+'%';document.getElementById('ach-progress-sub').innerText=Object.keys(state.achievements).length+'/'+achievementsDB.length;document.getElementById('hub-nitro-count').innerText=state.nitro;document.getElementById('daily-hub-sub').innerText=checkDailyEligible()?'Забрать!':'Уже забрано';
  const activeContracts=getActiveContracts(),done=activeContracts.filter(c=>contractStatus(c).done).length;document.getElementById('contract-progress-sub').innerText=done+'/'+activeContracts.length+' выполнено';document.getElementById('district-progress-sub').innerText=fmt(state.districtRep)+' REP';
  renderHeatStrip('profile-heat'); renderRecentRaceSummary();
  const licBox=document.getElementById('license-status-box');if(licBox){
    if(state.licenseSuspended)licBox.innerHTML='<div class="pre-race-line"><span> Водительские права изъяты</span></div><div class="empty-note" style="padding:4px 0 10px;text-align:left;">Заезды недоступны, пока не восстановишь права.</div><button class="big-btn" onclick="buyBackLicense()">ВОССТАНОВИТЬ · '+fmt(licensePrice())+' SYND</button>';
    else licBox.innerHTML='<div class="pre-race-line"><span> Права в порядке</span><b style="color:var(--green)">ДОПУСК К ЗАЕЗДАМ</b></div>';
  }
}


/* ==================== ECONOMY / PUBLIC PROFILES 3.0 ==================== */
function awardMoney(amount, reason){
  amount=Math.max(0,Math.round(amount));
  if(!amount) return;
  state.coins+=amount; state.stats.totalEarned+=amount;
  updateHeader();
  const root=document.getElementById('money-modal-root');
  if(root && state.settings.animations){
    root.innerHTML='<div class="money-burst"><div class="money-burst-card"><div class="money-symbol">₳</div><div class="money-amount">+'+fmt(amount)+'</div><div class="money-label">SYNDICATE CREDIT · '+escapeHtml(reason||'НАГРАДА')+'</div></div></div>';
    setTimeout(()=>{ if(root) root.innerHTML=''; },780);
  }
}
function openPublicProfile(name,val,wins,races,cars,profile){
  const root=document.getElementById('public-profile-root'); if(!root)return;
  const wr=races?Math.round(wins/races*100):0;
  const list=Array.isArray(cars)?cars:[].concat(cars||[]).filter(Boolean);
  const ownedHtml=list.length ? list.map(x=>'<span class="player-lb-car">'+escapeHtml(x)+'</span>').join('') : '<span style="color:var(--text-muted);font-size:10px;">Нет данных</span>';
  const balance=profile ? Number(profile.balance)||0 : Number(val)||0;
  const level=profile ? Number(profile.level)||1 : 1;
  root.innerHTML='<div class="modal-overlay" onclick="if(event.target===this)closePublicProfile()"><div class="public-profile">'+
    '<div class="pp-head"><div class="public-avatar">'+escapeHtml((name||'Г').charAt(0).toUpperCase())+'</div><div><div style="font-size:18px;font-weight:1000;">'+escapeHtml(name)+'</div><div style="color:var(--text-muted);font-size:10px;font-weight:900;">УРОВЕНЬ '+level+' · УЧАСТНИК СИНДИКАТА</div></div></div>'+
    '<div class="pp-grid"><div class="pp-stat"><span>Баланс</span><b>'+fmt(balance)+' SYND</b></div><div class="pp-stat"><span>Заработано</span><b>'+fmt(val)+' SYND</b></div><div class="pp-stat"><span>Победы</span><b>'+wins+'</b></div><div class="pp-stat"><span>Заезды</span><b>'+races+'</b></div><div class="pp-stat"><span>Процент побед</span><b>'+wr+'%</b></div></div>'+
    '<div class="pp-stat" style="margin-top:8px;"><span>Машины игрока</span><div class="player-lb-cars" style="margin-top:8px;">'+ownedHtml+'</div></div>'+
    '<button class="btn btn-ghost" style="margin-top:12px;" onclick="closePublicProfile()">ЗАКРЫТЬ</button></div></div>';
}
function openPublicProfileData(p){
  const owned=Array.isArray(p.owned_cars)?p.owned_cars:[];
  const cars=owned.map(id=>carsDB.find(c=>String(c.id)===String(id))).filter(Boolean);
  openPublicProfile(p.name,p.total_earned||0,p.wins||0,p.races||0,cars.map(c=>c.name),p);
}

function closePublicProfile(){const r=document.getElementById('public-profile-root');if(r)r.innerHTML='';}


/* ===== migrated from race.js ===== */
/* ==================== RACE 4.0 — SMOOTH DRAG SYSTEM ====================
   Архитектура:
   - requestAnimationFrame вместо setInterval
   - физика не пересоздаёт DOM
   - 6 передач, 6-я — физический предел
   - честный баланс машины + старт + переключения
   - две маленькие зоны: жёлтая / зелёная
*/
let raceCtx=null;
let speedFX={fov:1,shake:0};
const GEAR_LABELS=['N','1','2','3','4','5','6'];

function raceTuneProfile(car){
  const upg=typeof getUpg==='function'?getUpg(car.id):{};
  const sum=Object.values(upg||{}).reduce((a,b)=>a+(Number(b)||0),0);
  const engine=Number(upg.engine||0), trans=Number(upg.gearbox||0), turbo=Number(upg.turbo||0);
  const grip=Number(upg.tires||upg.grip||0);
  /* КПП расширяет окна, двигатель/турбо ускоряют набор оборотов. */
  const transLevel=Math.max(0,trans);
  const greenWidth=Math.min(0.095,0.028+transLevel*.010);
  const yellowWidth=Math.min(0.15,greenWidth+0.028+transLevel*.006);
  return {
    sum,engine,trans,turbo,grip,
    rpmRate:1.15+sum*.065+engine*.035+turbo*.055,
    greenWidth,yellowWidth,
    launchGrip:Math.min(.98,.70+transLevel*.025+grip*.025),
    accel:1.18+engine*.025+turbo*.045,
    shiftRecovery:Math.min(.72,.52+transLevel*.035)
  };
}
function prepareRace(target,mode){
  let opp;
  if(mode==='pvp'){
    opp={id:target.id,name:(target.challenger_name||'Игрок')+' ',power:target.power,reward:target.stake*2,pvp:true,stake:target.stake,row:target};
  }else{
    const list=mode==='tour'?tournamentsDB:opponentsDB;
    opp=list.find(o=>String(o.id)===String(target));
  }
  if(mode==='tour' && opp){
    const now=Date.now(), dayKey=new Date().toISOString().slice(0,10), key=String(opp.id);
    const r=state.tournamentRuns[key]||{};
    const count=r.day===dayKey?(Number(r.count)||0):0;
    const next=r.day===dayKey?(Number(r.next)||0):0;
    if(count>=3){showToast(' Этот турнир уже сыгран 3 раза сегодня.');renderOpponents();return;}
    if(next>now){showToast('⏳ Следующая попытка будет доступна через '+Math.ceil((next-now)/60000)+' мин.');renderOpponents();return;}
  }
  const car=carsDB.find(c=>c.id===state.activeCarId);
  if(!car||!opp)return;
  if(state.licenseSuspended){showToast(' Права изъяты. Заработай через подработку или восстанови права.');switchTab('duel-select');return;}
  const fee=opp.pvp?opp.stake:entryFeeFor(opp),fuelCost=opp.pvp?18:fuelCostFor(opp);
  if(state.coins<fee){showToast('Недостаточно SYND для входа');switchTab('jobs');return;}
  if(getFuel(car.id)<fuelCost){showToast('Недостаточно топлива');openDetail(car.id);return;}
  if(mode==='tour'){
    const now=Date.now(), dayKey=new Date().toISOString().slice(0,10), key=String(opp.id);
    const r=state.tournamentRuns[key]||{};
    const count=r.day===dayKey?(Number(r.count)||0):0;
    const next=r.day===dayKey?(Number(r.next)||0):0;
    state.tournamentRuns[key]={day:dayKey,count:count+1,next:now+15*60*1000};
    saveState();
  }
  const profile=raceTuneProfile(car);
  const route=['Промзона','Ночной проспект','Портовый обход','Тоннель','Старая эстакада'][Math.floor(Math.random()*5)];
  const radarChance=opp.pvp?0:Math.min(.48,0.08+(opp.boss?.06:0)+(Number(state.heat)||0)*.055);
  const rawPower=getEffectivePower(car);
  const maxSpeed=Math.round(Math.max(170,Math.min(380,175+rawPower*.115)));
  const aiMaxSpeed=Math.round(Math.max(165,Math.min(380,175+(Number(opp.power)||rawPower)*.115)));
  const trackLength=1200;
  raceCtx={
    opp,mode,fee,fuelCost,useNitro:false,profile,route,radarChance,
    radar:false,gas:false,brake:false,gear:1,rpm:1100,speed:0,distance:0,
    aiDistance:0,aiSpeed:0,aiGear:1,aiRpm:1200,aiShiftTimer:0,aiSkill:0,aiFinishedAt:0,playerFinishedAt:0,lastLead:0,lastPassAt:0,trackLength:trackLength,
    finished:false,launchMode:null,shiftCount:0,goodShifts:0,perfectShifts:0,errors:0,elapsed:0,actionTimer:0,actionText:'',
    lastTs:0,raf:null,launchIv:null,uiTimer:0,uiInterval:0,displayRpm:null,displaySpeed:null,
    maxSpeed,aiMaxSpeed,redline:8500,startLocked:false,startTimer:0,nitroActive:false,nitroTimer:0,nitroUsed:false,topSpeed:0
  };
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-race').classList.add('active');
  document.getElementById('main-scroll').scrollTop=0;
  renderRaceBrief();
}
function renderRaceBrief(){
  const c=raceCtx,car=carsDB.find(x=>x.id===state.activeCarId),o=c.opp;
  document.getElementById('race-content').innerHTML=
  '<div class="race3"><div class="race-event-badge"><span>НОВАЯ ЛИНИЯ · '+c.route+'</span><b>СЦЕНАРИЙ #'+(1+Math.floor(Math.random()*99))+'</b></div>'+
  '<div class="race3-top"><div class="race3-driver"><b>ВЫ</b><span>'+escapeHtml(car.name)+'</span></div><div class="race3-vs">VS</div><div class="race3-driver" style="text-align:right;"><b>'+escapeHtml(o.name)+'</b><span>'+o.power+' л.с.</span></div></div>'+
  '<div class="pre-race-box"><div class="pre-race-line"><span>Вход</span><b>'+fmt(c.fee)+' SYND</b></div><div class="pre-race-line"><span>Топливо</span><b>'+c.fuelCost+'%</b></div><div class="pre-race-line"><span>Победа</span><b style="color:var(--gold)">+'+fmt(o.reward)+' SYND</b></div><div class="pre-race-line"><span>Радар</span><b style="color:var(--text-muted)">случайное событие</b></div></div>'+
  '<button class="big-btn" onclick="beginLaunch()">ВЫЕХАТЬ НА ЛИНИЮ</button><button class="btn btn-ghost" style="margin-top:8px;" onclick="switchTab(\'duel-select\')">ОТМЕНА</button></div>';
}
function beginLaunch(){
  const car=carsDB.find(c=>c.id===state.activeCarId),c=raceCtx;
  state.coins-=c.fee;state.stats.totalSpent+=c.fee;state.fuel[car.id]=Math.max(0,getFuel(car.id)-c.fuelCost);
  updateHeader();saveState();
  document.getElementById('race-content').innerHTML=
  '<div class="race3"><div class="race-event-badge"><span>СТАРТ · '+c.route+'</span><b>ПОДБЕРИ ОБОРОТЫ</b></div>'+
  '<div class="launch-panel"><div style="font-size:14px;font-weight:1000;">ЛОВИ ЗЕЛЁНУЮ ЗОНУ</div><div style="font-size:10px;color:var(--text-muted);margin-top:4px;">Жёлтая — хороший старт. Зелёная — идеальный. Ошибка даёт сопернику преимущество.</div>'+
  '<div class="launch-meter"><div class="launch-zone yellow"></div><div class="launch-zone green"></div><div class="launch-marker" id="launch-marker"></div></div>'+
  '<div class="launch-rpm" id="launch-rpm">1 100 RPM</div>'+
  '<div class="launch-buttons"><button class="launch-btn safe" onclick="chooseLaunch(\'safe\')">АККУРАТНО<br><small>контроль сцепления</small></button><button class="launch-btn hard" onclick="chooseLaunch(\'spin\')">ШЛИФОВКА<br><small>максимум старта</small></button></div></div></div>';
  c.launchPos=15;c.launchDir=1;
  c.launchIv=setInterval(()=>{
    const m=document.getElementById('launch-marker'),r=document.getElementById('launch-rpm');
    if(!m){clearInterval(c.launchIv);return;}
    c.launchPos+=c.launchDir*(1.45+c.profile.rpmRate*.18);
    if(c.launchPos>=90){c.launchPos=90;c.launchDir=-1;}
    if(c.launchPos<=8){c.launchPos=8;c.launchDir=1;}
    m.style.left=c.launchPos+'%';
    if(r)r.textContent=Math.round(900+c.launchPos/100*7600).toLocaleString('fi-FI')+' ОБ/МИН';
  },32);
}
function chooseLaunch(mode){
  const c=raceCtx;if(!c)return;
  clearInterval(c.launchIv);
  c.launchMode=mode;
  const pos=c.launchPos/100;
  const center=0.67;
  const error=Math.abs(pos-center);
  const quality=Math.max(0,1-error/.30);
  if(quality>=.90){state.raceStats.perfectStarts=(state.raceStats.perfectStarts||0)+1;haptic('success');}
  if(mode==='spin'){
    state.raceStats.hardLaunches=(state.raceStats.hardLaunches||0)+1;
    c.rpm=4700+quality*900;c.speed=10+quality*8;c.distance=1.2+quality*1.2;
    c.launchGrip=Math.max(.76,c.profile.launchGrip-(1-quality)*.12);
  }else{
    state.raceStats.safeLaunches=(state.raceStats.safeLaunches||0)+1;
    c.rpm=2600+quality*1900;c.speed=7+quality*8;c.distance=.8+quality*1.4;
    c.launchGrip=.98;
  }
  /* AI старт не идеальный по умолчанию. Его шанс зависит от силы машины. */
  const myPower=getEffectivePower(carsDB.find(x=>x.id===state.activeCarId));
  const powerRatio=Math.max(.78,Math.min(1.22,c.opp.power/Math.max(myPower,1)));
  c.aiSkill=Math.max(.92,Math.min(1.02,.97+(powerRatio-1)*.04+(Math.random()-.5)*.06));
  c.aiDistance=Math.max(0,c.distance-(Math.random()*1.4));
  c.aiStartDelay=0.85+Math.random()*0.55;
  c.aiSpeed=0;c.aiGear=1;c.aiRpm=2600+Math.random()*1700;
  showRaceCockpit();
}
function showRaceCockpit(){
  const c=raceCtx,car=carsDB.find(x=>x.id===state.activeCarId),o=c.opp;
  document.getElementById('race-content').innerHTML=
  '<div class="race3"><div class="race3-top"><div class="race3-driver"><b>'+escapeHtml(car.name)+'</b><span>'+getEffectivePower(car)+' л.с.</span></div><div class="race3-vs">VS</div><div class="race3-driver" style="text-align:right;"><b>'+escapeHtml(o.name)+'</b><span>'+o.power+' л.с.</span></div></div>'+
  '<div class="race-start-light" id="race-start-light"><div class="traffic-light"><i class="tl-red on"></i><i class="tl-yellow"></i><i class="tl-green"></i></div><b id="race-start-text">ГОТОВЬСЯ</b></div>'+
  '<div class="race-map"><div class="speed-effects" id="speed-effects"></div><div class="map-label start">START</div><div class="map-label finish">FINISH</div><div class="map-start"></div><div class="map-finish"></div><div class="map-road"><div class="map-car" id="map-me" style="left:3%"><span>YOU</span></div><div class="map-car ai" id="map-ai" style="left:3%"><span>RIVAL</span></div><div class="race-gap" id="race-gap">СТАРТ</div></div></div>'+
  '<div class="race-event-badge"><span id="race-status">ГАЗ ДЛЯ РАЗГОНА · ЛОВИ ЗОНУ</span><b id="race-route">'+c.route+'</b></div><div class="race-lead" id="race-lead">Позиция: РОВНО · до финиша '+c.trackLength+' м</div>'+'<div class="race-action" id="race-action"></div>'+

  '<div class="cockpit3"><div class="analog-gauge tacho3"><div class="gauge-caption">ОБ/МИН ×1000</div><div class="dial zone-dial" id="rpm-dial"><div class="dial-ticks"></div><div class="dial-needle" id="rpm-needle"></div><div class="dial-hub"></div><div class="gear3" id="race-gear">1</div><div class="gauge-center"><b id="race-rpm">1.1</b><span>×1000</span></div></div><div class="gauge-scale"><span>0</span><span>4</span><span>8.5</span></div></div>'+
  '<div class="analog-gauge speed3"><div class="gauge-caption">SPEED</div><div class="dial speed-dial zone-dial" id="speed-dial"><div class="dial-ticks"></div><div class="dial-needle speed-needle" id="speed-needle"></div><div class="dial-hub"></div><div class="gauge-center"><b id="race-speed">0</b><span>KM/H</span></div></div><div class="gauge-scale"><span>0</span><span>'+c.maxSpeed+'</span></div></div></div>'+
  '<div class="race-controls"><button class="race-control pedal brake" id="brake-btn" onpointerdown="raceHold(\'brake\',true)" onpointerup="raceHold(\'brake\',false)" onpointercancel="raceHold(\'brake\',false)" onpointerleave="raceHold(\'brake\',false)"><span class="pedal-face">BRAKE</span><small>ТОРМОЗ</small></button><button class="race-control pedal gas" id="gas-btn" onpointerdown="raceHold(\'gas\',true)" onpointerup="raceHold(\'gas\',false)" onpointercancel="raceHold(\'gas\',false)" onpointerleave="raceHold(\'gas\',false)"><span class="pedal-face">GAS</span><small>ГАЗ</small></button><button class="race-control shift" id="shift-btn" onclick="manualShift()"><span class="shift-face">↑</span><small id="shift-label">SHIFT · 1→2</small></button><button class="race-control nitro" id="nitro-btn" onclick="useRaceNitro()"><span class="nitro-face">N₂O</span><small id="nitro-label">'+state.nitro+' ЗАРЯД.</small><div class="race-nitro-bar"><i id="nitro-bar-fill"></i></div></button></div>'+
  '<div class="shift-mini" id="shift-help">Жёлтая — хорошо · зелёная — идеально</div></div>';
  c.gas=false;c.brake=false;c.startLocked=true;c.startTimer=0;c.lastTs=performance.now();c.uiTimer=0;
  updateRaceZones();updateRaceHUD();
  startTrafficLight();
  c.raf=requestAnimationFrame(raceFrame);
  if(state.settings.sound)showToast(c.launchMode==='spin'?' ШЛИФОВКА!':' Чистый старт');
}
function startTrafficLight(){
  const c=raceCtx;if(!c)return;
  const root=document.getElementById('race-start-light');
  const red=root&&root.querySelector('.tl-red'),yellow=root&&root.querySelector('.tl-yellow'),green=root&&root.querySelector('.tl-green'),text=document.getElementById('race-start-text');
  if(!root)return;
  root.classList.add('show');
  const steps=[
    ()=>{ if(red)red.classList.add('on'); if(yellow)yellow.classList.remove('on'); if(green)green.classList.remove('on'); if(text)text.innerText='ГОТОВЬСЯ'; },
    ()=>{ if(red)red.classList.add('on'); if(yellow)yellow.classList.add('on'); if(green)green.classList.remove('on'); if(text)text.innerText='НА СТАРТ'; },
    ()=>{ if(red)red.classList.remove('on'); if(yellow)yellow.classList.remove('on'); if(green)green.classList.add('on'); if(text)text.innerText='ПОЕХАЛИ'; showAction('GREEN LIGHT · ПОЕХАЛИ!'); },
    ()=>{ c.startLocked=false; c.startTimer=0; if(root)root.classList.remove('show'); }
  ];
  steps[0]();
  setTimeout(steps[1],650);
  setTimeout(steps[2],1250);
  setTimeout(steps[3],1850);
}
function showAction(text){
  const c=raceCtx;if(!c)return;
  c.actionText=text;c.actionTimer=1.35;
  const el=document.getElementById('race-action');
  if(el){el.textContent=' '+text;el.classList.remove('show');void el.offsetWidth;el.classList.add('show');}
}

function raceHold(type,on){
  if(!raceCtx||raceCtx.finished)return;
  raceCtx[type]=on;
  const b=document.getElementById(type==='gas'?'gas-btn':'brake-btn');
  if(b)b.classList.toggle('active',on);
}
function manualShift(){
  const c=raceCtx;if(!c||c.finished)return;
  if(c.gear>=6){
    c.gear=6;
    const status=document.getElementById('race-status');if(status)status.innerText='6-Я ПЕРЕДАЧА · МАКСИМУМ';
    updateRaceHUD();return;
  }
  const p=c.rpm/c.redline;
  c.shiftCount++;
  const g=c.profile.greenWidth,y=c.profile.yellowWidth;
  const perfectCenter=.72;
  const perfect=Math.abs(p-perfectCenter)<=g;
  const good=Math.abs(p-perfectCenter)<=y;
  c.gear=Math.min(6,c.gear+1);
  if(perfect){
    c.perfectShifts++;c.goodShifts++;recordContractEvent('perfectShift',1);haptic('success');showAction('ИДЕАЛЬНЫЙ SHIFT!');c.rpm=Math.max(3000,c.rpm*c.profile.shiftRecovery);
    showShiftText('ИДЕАЛЬНОЕ ПЕРЕКЛЮЧЕНИЕ',true);
  }else if(good){
    c.goodShifts++;haptic('medium');showAction('ХОРОШЕЕ ПЕРЕКЛЮЧЕНИЕ');c.rpm=Math.max(2700,c.rpm*c.profile.shiftRecovery*.94);
    showShiftText('ХОРОШЕЕ ПЕРЕКЛЮЧЕНИЕ',false);
  }else if(p>.92){
    c.errors++;haptic('warning');showAction('ПОЗДНИЙ SHIFT · ПОТЕРЯ ТЯГИ');c.rpm=Math.max(3000,c.rpm*.54);showShiftText('ПОЗДНО · ПОТЕРЯ ТЯГИ',false);
  }else{
    c.errors++;haptic('warning');showAction('РАННИЙ SHIFT · ПОТЕРЯ ТЯГИ');c.rpm=Math.max(2100,c.rpm*.68);showShiftText('РАНО · ПОТЕРЯ ТЯГИ',false);
  }
  updateRaceHUD();
}
function showShiftText(text,perfect){
  const status=document.getElementById('race-status');if(status)status.innerText=text;
  const root=document.getElementById('race-content');
  if(root){root.classList.remove('shift-flash');void root.offsetWidth;root.classList.add(perfect?'perfect-shift-flash':'shift-flash');}
}
function raceFrame(now){
  const c=raceCtx;if(!c||c.finished)return;
  let dt=(now-(c.lastTs||now))/1000;
  c.lastTs=now;
  dt=Math.max(.001,Math.min(.034,dt));
  simulateRace(dt);
  c.uiTimer+=dt;
  /* Физика каждый кадр, DOM — максимум ~30 раз/сек. Стрелки получают transform. */
  if(c.uiTimer>=.066){c.uiTimer=0;updateRaceHUD();}
  if(!c.finished)c.raf=requestAnimationFrame(raceFrame);
}
function simulateRace(dt){
  const c=raceCtx;
  if(c.startLocked) return;
  c.elapsed+=dt;
  if(c.nitroTimer>0){c.nitroTimer=Math.max(0,c.nitroTimer-dt);c.nitroActive=c.nitroTimer>0;}
  if(c.actionTimer>0){ c.actionTimer-=dt; if(c.actionTimer<=0){ const a=document.getElementById('race-action'); if(a)a.classList.remove('show'); } }
  const p=c.profile,gear=c.gear;
  const ratios=[0,.58,.72,.82,.90,.96,1];
  const ratio=ratios[gear];
  const rpmNorm=c.rpm/c.redline;
  if(c.gas&&!c.brake){
    const gain=1450*p.rpmRate*(.72+ratio*.36)*dt;
    if(gear<6)c.rpm=Math.min(c.redline*1.015,c.rpm+gain);
    else c.rpm=Math.min(c.redline*.995,c.rpm+gain*.20);
    const band=Math.max(.15,Math.min(1,rpmNorm));
    const launchTraction=(c.launchMode==='spin'&&c.distance<9)?c.launchGrip:.99;
    /* Сильный старт + быстрый набор скорости, без улиточного темпа. */
    const nitroBoost=c.nitroActive?1.34:1;
    const baseAccel=(c.maxSpeed*.92)*p.accel*ratio*(.52+band*.82)*launchTraction*nitroBoost;
    const resistance=.020*c.speed*c.speed/c.maxSpeed;
    c.speed+=Math.max(0,baseAccel-resistance)*dt;
    if(gear===6){
      /* 6-я передача — длинная: скорость не прыгает к максимальной
         только из-за включения 6-й. Она продолжает расти физически. */
      c.rpm=Math.min(c.redline*.995,c.rpm);
    }
  }else{
    c.rpm=Math.max(1100,c.rpm-1050*dt);
    c.speed=Math.max(0,c.speed-5.5*dt);
  }
  if(c.brake){
    c.rpm=Math.max(1100,c.rpm-3000*dt);
    c.speed=Math.max(0,c.speed-70*dt);
  }
  const speedCap=c.nitroActive?Math.min(400,c.maxSpeed*1.045):c.maxSpeed;
  c.speed=Math.max(0,Math.min(speedCap,c.speed));
  c.topSpeed=Math.max(c.topSpeed||0,c.speed);
  /* Реальная дистанция: км/ч -> м/с. Финиш только на физическом конце 1200 м. */
  c.distance=Math.min(c.trackLength,c.distance+(c.speed/3.6)*dt);

  /* AI тоже движется по той же физической дистанции. Он может быть впереди/сзади,
     но не завершает раунд сам по себе: результат фиксируется только после того,
     как игрок пересёк физическую финишную линию. */
  const myPower=getEffectivePower(carsDB.find(x=>x.id===state.activeCarId));
  const ratioPower=Math.max(.72,Math.min(1.28,c.opp.power/Math.max(myPower,1)));
  const aiPace=Math.max(.88,Math.min(1.02,.95+(ratioPower-1)*.12));
  const targetVariation=1+Math.sin(c.elapsed*.63)*.025+Math.sin(c.elapsed*1.71)*.012;
  const aiTarget=Math.min(c.aiMaxSpeed*.985,c.aiMaxSpeed*aiPace*c.aiSkill*targetVariation);
  c.aiSpeed+=((aiTarget-c.aiSpeed)*1.25*dt);
  if(c.elapsed<c.aiStartDelay)c.aiSpeed*=Math.max(0,1-dt*5);
  c.aiSpeed=Math.max(0,Math.min(c.aiMaxSpeed*.985,c.aiSpeed));
  c.aiDistance=Math.min(c.trackLength,c.aiDistance+(c.aiSpeed/3.6)*dt);

  /* Важно: соперник, пересёкший финиш, не закрывает экран. Игрок обязан
     физически доехать до конца, и только тогда определяется победитель. */
  if(c.aiDistance>=c.trackLength && !c.aiFinishedAt){
    c.aiFinishedAt=c.elapsed;
    showAction('СОПЕРНИК ПЕРЕСЁК ФИНИШ · ДОЕЗЖАЙ ДО КОНЦА');
    const status=document.getElementById('race-status');if(status)status.innerText='СОПЕРНИК УЖЕ НА ФИНИШЕ · ДОЕЗЖАЙ ДО КОНЦА';
  }
  if(c.distance>=c.trackLength){
    c.playerFinishedAt=c.elapsed;
    finishRace(!c.aiFinishedAt || c.playerFinishedAt<=c.aiFinishedAt,c);return;
  }
}
function useRaceNitro(){
  const c=raceCtx;if(!c||c.finished||c.startLocked)return;
  if(c.nitroUsed){showAction('NITRO УЖЕ ИСПОЛЬЗОВАНО');return;}
  if(state.nitro<=0){showAction('НЕТ ЗАРЯДОВ N₂O');haptic('error');return;}
  state.nitro--;c.nitroUsed=true;c.nitroActive=true;c.nitroTimer=2.4;state.raceStats.nitroUses=(state.raceStats.nitroUses||0)+1;
  recordContractEvent('nitro',1);showAction('N₂O · ПОЛНЫЙ БУСТ');haptic('heavy');saveState();updateRaceHUD();
}

function updateRaceZones(){
  const c=raceCtx;if(!c)return;
  const greenDeg=Math.max(7,Math.min(28,c.profile.greenWidth*360));
  const yellowDeg=Math.max(greenDeg+8,Math.min(52,c.profile.yellowWidth*360));
  /* Индикатор центрирован вокруг 72% шкалы. Только две маленькие зоны. */
  const center=0.72*264-132;
  const start=center-yellowDeg/2,end=center+yellowDeg/2;
  const gs=center-greenDeg/2,ge=center+greenDeg/2;
  const d=document.getElementById('rpm-dial');
  if(d){
    d.style.setProperty('--yellow-start',start+'deg');
    d.style.setProperty('--yellow-end',end+'deg');
    d.style.setProperty('--green-start',gs+'deg');
    d.style.setProperty('--green-end',ge+'deg');
  }
  const speedDial=document.getElementById('speed-dial');
  if(speedDial){
    speedDial.style.setProperty('--yellow-start','999deg');
    speedDial.style.setProperty('--yellow-end','1000deg');
    speedDial.style.setProperty('--green-start','1001deg');
    speedDial.style.setProperty('--green-end','1002deg');
  }
}
function updateRaceHUD(){
  const c=raceCtx;if(!c)return;
  const rpmEl=document.getElementById('race-rpm'),gear=document.getElementById('race-gear'),sp=document.getElementById('race-speed'),me=document.getElementById('map-me'),ai=document.getElementById('map-ai');
  if(rpmEl)rpmEl.innerText=(c.rpm/1000).toFixed(1);
  /* Визуальные стрелки инерционные: реальные RPM/скорость меняются сразу,
     но стрелка догоняет значение плавно, поэтому после переключения нет резкого скачка. */
  const smoothK=0.22;
  if(c.displayRpm==null)c.displayRpm=c.rpm;
  if(c.displaySpeed==null)c.displaySpeed=c.speed;
  c.displayRpm += (c.rpm-c.displayRpm)*smoothK;
  c.displaySpeed += (c.speed-c.displaySpeed)*smoothK;
  const rpmNeedle=document.getElementById('rpm-needle');
  if(rpmNeedle)rpmNeedle.style.transform='rotate('+(-132+(c.displayRpm/c.redline)*264)+'deg)';
  const speedNeedle=document.getElementById('speed-needle');
  if(speedNeedle)speedNeedle.style.transform='rotate('+(-132+(c.displaySpeed/Math.max(c.maxSpeed,1))*264)+'deg)';
  const fx=document.getElementById('speed-effects');if(fx)fx.classList.toggle('fast',c.speed>c.maxSpeed*.55);
  if(gear)gear.innerText=c.gear;
  if(sp)sp.innerText=Math.round(c.speed);
  const mePct=Math.max(0,Math.min(100,c.distance/c.trackLength*100));
  const aiPct=Math.max(0,Math.min(100,c.aiDistance/c.trackLength*100));
  if(me){me.style.left=(4+mePct*.92)+'%';me.style.transform='translateX(-50%)';}
  if(ai){ai.style.left=(4+aiPct*.92)+'%';ai.style.transform='translateX(-50%)';}
  const gapEl=document.getElementById('race-gap');
  const leadEl=document.getElementById('race-lead');
  const gap=c.distance-c.aiDistance;
  const leadSign=gap>2?1:gap<-2?-1:0;
  if(leadSign!==c.lastLead && c.elapsed>1.2){
    if(leadSign===1) showAction('ОБГОН! ТЫ ВЫШЕЛ ВПЕРЁД');
    else if(leadSign===-1) showAction('ТЕБЯ ОБОШЛИ! НАЖИМАЙ И ОТЫГРЫВАЙСЯ');
    c.lastLead=leadSign;
  }
  if(gapEl){
    if(Math.abs(gap)<2) gapEl.innerText='РОВНО · БОРЬБА ЗА ПОЗИЦИЮ';
    else if(gap>0) gapEl.innerText='YOU +'+Math.abs(gap).toFixed(1)+' м ВПЕРЕДИ';
    else gapEl.innerText='RIVAL +'+Math.abs(gap).toFixed(1)+' м ВПЕРЕДИ';
  }
  if(leadEl){
    const remain=Math.max(0,c.trackLength-c.distance);
    leadEl.innerText=(gap>2?'ТЫ ВПЕРЕДИ · ':gap<-2?'СОПЕРНИК ВПЕРЕДИ · ':'РОВНО · ')+'до финиша '+Math.ceil(remain)+' м';
  }
  const help=document.getElementById('shift-help');
  if(help)help.innerText=c.gear>=6?'6-я передача · МАКСИМУМ · держи газ':'Передача '+c.gear+' · жёлтая — хорошо · зелёная — идеально';
  const sb=document.getElementById('shift-btn');if(sb)sb.classList.toggle('locked',c.gear>=6);
  const sl=document.getElementById('shift-label');if(sl)sl.innerText=c.gear>=6?'6 · МАКС.':('ПЕРЕКЛЮЧИТЬ · '+c.gear+'→'+Math.min(6,c.gear+1));
  const nb=document.getElementById('nitro-btn'),nl=document.getElementById('nitro-label'),nf=document.getElementById('nitro-bar-fill');
  if(nb)nb.classList.toggle('used',c.nitroUsed||state.nitro<=0);if(nl)nl.innerText=c.nitroUsed?'ИСПОЛЬЗОВАНО':state.nitro+' ЗАРЯД.';if(nf)nf.style.width=(c.nitroActive?Math.round(c.nitroTimer/2.4*100):0)+'%';
}
function finishRace(playerWins,c){
  if(c.finished)return;
  c.finished=true;
  if(c.raf)cancelAnimationFrame(c.raf);
  if(c.launchIv)clearInterval(c.launchIv);
  const car=carsDB.find(x=>x.id===state.activeCarId),opp=c.opp;
  state.stats.races++;state.condition[car.id]=Math.max(0,getCondition(car.id)-(c.errors>2?5:3));
  state.raceStats.perfectShifts=(state.raceStats.perfectShifts||0)+c.perfectShifts;
  const performance=Math.max(0,Math.min(1,(c.goodShifts*2+c.perfectShifts*2-c.errors)/(Math.max(3,c.shiftCount*2))));
  let reward=0,xp=0;
  const tourRun = c.mode==='tour' ? (state.tournamentRuns[String(opp.id)]||{}) : null;
  const todayKey = new Date().toISOString().slice(0,10);
  const completedAttempt = c.mode==='tour' && tourRun && tourRun.day===todayKey ? Math.max(1,Number(tourRun.count)||1) : 1;
  const tourRewardMult = c.mode==='tour' ? ([1,.72,.48][Math.min(2,completedAttempt-1)]||.48) : 1;
  if(playerWins){
    state.stats.wins++;if(opp.boss)state.stats.bossWins=(state.stats.bossWins||0)+1;state.winStreak=(state.winStreak||0)+1;
    /* Экономика прозрачная: выплата РОВНО такая, какая была показана до старта.
       Никаких скрытых бонусов за серию, идеальные переключения или старт. */
    reward=Math.max(0,Math.round(opp.reward*tourRewardMult));
    xp=(opp.boss||c.mode==='tour')?40:16;
    if(opp.pvp)resolvePvpChallenge(opp.row,true,reward);
  }else{
    state.stats.losses++;state.winStreak=0;reward=0;xp=4;
    if(opp.pvp)resolvePvpChallenge(opp.row,false,0);
  }
  const id=String(opp.id);state.raceHistory=(state.raceHistory||[]).filter(x=>x!==id);state.raceHistory.push(id);state.raceHistory=state.raceHistory.slice(-8);
  recordCareerRace(playerWins,opp);recordRaceTelemetry({ts:Date.now(),won:playerWins,opponent:opp.name,route:c.route,time:c.elapsed,topSpeed:c.topSpeed||c.speed,perfectShifts:c.perfectShifts,nitroUsed:c.nitroUsed});
  addXP(xp);awardMoney(reward,playerWins?'ПОБЕДА В ЗАЕЗДЕ':'УТЕШИТЕЛЬНЫЙ ПРИЗ');
  const el=document.getElementById('race-content');
  el.innerHTML='<div class="race3"><div class="result-box '+(playerWins?'win':'lose')+'"><div class="result-title">'+(playerWins?' ФИНИШ ПЕРВЫМ':' ФИНИШ ВТОРЫМ')+'</div>'+
    '<div class="result-sub">'+(playerWins?'Ты пересёк физическую линию FINISH первым.':'Ты пересёк физическую линию FINISH после соперника.')+'</div>'+
    '<div class="result-reward">'+(reward>0?'+':'')+fmt(reward)+' SYND</div>'+
    '<div class="xp-gain-box">⭐ +'+xp+' XP · '+c.elapsed.toFixed(2)+' c · МАКС. '+Math.round(c.topSpeed||c.speed)+' км/ч · ИДЕАЛЬНЫХ ПЕРЕКЛЮЧЕНИЙ '+c.perfectShifts+'</div></div>'+
    '<div class="list-container"><button class="btn btn-select" onclick="switchTab(\'duel-select\')">НОВАЯ СЛУЧАЙНАЯ ПАРА</button><button class="btn btn-ghost" onclick="switchTab(\'garage\')">В ГАРАЖ</button></div></div>';
  updateHeader();saveState();checkAchievements();
  try{
    const raceId=crypto.randomUUID();
    void serverFetch('/api/race/submit',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      raceId,opponentId:String(opp.id),route:String(c.route||'route'),won:!!playerWins,elapsedMs:Math.round(c.elapsed*1000),
      topSpeedKmh:Number(c.topSpeed||c.speed||0),perfectShifts:Number(c.perfectShifts||0),goodShifts:Number(c.goodShifts||0),
      missedShifts:Number(c.errors||0),startedInGear:1,finishGear:Math.max(1,Math.min(6,Number(c.gear)||1))
    })}).then(r=>{if(!r.ok)console.warn('race server submit rejected',r.status);}).catch(e=>console.warn('race server submit failed',e));
  }catch(e){console.warn('race id generation failed',e);}
  if(!opp.pvp&&Math.random()<c.radarChance){state.raceStats.radarEvents=(state.raceStats.radarEvents||0)+1;setTimeout(triggerPoliceStop,700);}
}
function triggerPoliceStop(){
  const root=document.getElementById('police-modal-root');if(!root)return;
  state.raceStats.policeStops=(state.raceStats.policeStops||0)+1;haptic('warning');
  const line=POLICE_LINES[Math.floor(Math.random()*POLICE_LINES.length)];
  root.innerHTML='<div class="modal-overlay"><div class="police-modal"><div class="police-lights"><span></span><span></span></div><div class="police-title"> РАДАР СРАБОТАЛ</div><div class="police-line">'+line+'</div>'+
    '<button class="big-btn police-opt negotiate" onclick="policeChoice(\'negotiate\')"> Договориться</button><button class="big-btn police-opt pay" onclick="policeChoice(\'pay\')"> Заплатить штраф ('+fmt(POLICE_BASE_FINE)+' SYND)</button><button class="big-btn police-opt refuse" onclick="policeChoice(\'refuse\')"> Спорить</button></div></div>';
}
function closePoliceModal(){const r=document.getElementById('police-modal-root');if(r)r.innerHTML='';}
function policeChoice(choice){
  let resultHtml='';
  if(choice==='pay'){const fine=POLICE_BASE_FINE;state.coins=Math.max(0,state.coins-fine);reduceHeat(2);state.stats.finesPaid+=fine;state.stats.finesCount++;resultHtml='<div class="police-line">Штраф оплачен. Можно ехать дальше.</div><div class="result-reward">-'+fmt(fine)+' SYND</div>';}
  else if(choice==='negotiate'){if(Math.random()<.55){const bribe=Math.round(POLICE_BASE_FINE*.4)+Math.round(Math.random()*80);state.coins=Math.max(0,state.coins-bribe);reduceHeat(1);resultHtml='<div class="police-line">Инспектор махнул рукой. Вопрос закрыт.</div><div class="result-reward">-'+fmt(bribe)+' SYND</div>';}else{const fine=Math.round(POLICE_BASE_FINE*1.8);state.coins=Math.max(0,state.coins-fine);state.stats.finesPaid+=fine;state.stats.finesCount++;resultHtml='<div class="police-line">Договориться не вышло. Штраф увеличен.</div><div class="result-reward">-'+fmt(fine)+' SYND</div>';}}
  else{if(Math.random()<.35){resultHtml='<div class="police-line">Инспектор не стал связываться.</div><div class="result-reward" style="color:var(--green)">Уехал без штрафа</div>';}else{state.hasLicense=false;state.licenseSuspended=true;state.licenseSuspendCount=(state.licenseSuspendCount||0)+1;resultHtml='<div class="police-line">Права изъяты. Но игра не загнала тебя в тупик: заработок доступен в Подработке и Банке.</div><div class="result-reward"> '+fmt(licensePrice())+' SYND на восстановление</div>';}}
  updateHeader();saveState();
  const root=document.getElementById('police-modal-root');
  root.innerHTML='<div class="modal-overlay"><div class="police-modal"><div class="police-title"> РЕШЕНИЕ ДПС</div>'+resultHtml+'<button class="big-btn" style="margin-top:10px;" onclick="closePoliceModal();switchTab(\'profile\')">ПОНЯТНО</button></div></div>';
}
function buyBackLicense(){
  const price=licensePrice();
  if(state.coins<price){showToast('Не хватает SYND. Открой Подработку — деньги можно получить без прав.');switchTab('jobs');return;}
  if(!confirm('Восстановить права за '+fmt(price)+' SYND?'))return;
  state.coins-=price;state.stats.totalSpent+=price;state.hasLicense=true;state.licenseSuspended=false;
  showToast(' Права восстановлены');updateHeader();saveState();renderProfile();
}


/* Desktop controls: W/↑ gas, S/↓ brake, Space/E shift, N/Shift nitro. */
(function bindRaceKeyboard(){
  const active=()=>document.getElementById('screen-race')?.classList.contains('active')&&raceCtx&&!raceCtx.finished;
  window.addEventListener('keydown',e=>{
    if(!active()||e.repeat)return;
    if(['ArrowUp','ArrowDown','Space'].includes(e.code))e.preventDefault();
    if(e.code==='KeyW'||e.code==='ArrowUp')raceHold('gas',true);
    if(e.code==='KeyS'||e.code==='ArrowDown')raceHold('brake',true);
    if(e.code==='Space'||e.code==='KeyE')manualShift();
    if(e.code==='KeyN'||e.code==='ShiftLeft'||e.code==='ShiftRight')useRaceNitro();
  },{passive:false});
  window.addEventListener('keyup',e=>{
    if(!active())return;
    if(e.code==='KeyW'||e.code==='ArrowUp')raceHold('gas',false);
    if(e.code==='KeyS'||e.code==='ArrowDown')raceHold('brake',false);
  });
})();


/* ===== migrated from multiplayer.js ===== */
/* ==================== SUPABASE (МУЛЬТИПЛЕЕР: РЫНОК + ЧАТ) ==================== */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
let sb = null;
let marketChannel = null;
let chatChannel = null;
const MAX_MARKET_PRICE=2_000_000;
const MAX_PVP_STAKE=25_000;
const CHAT_RATE_MS=2500;
const CHAT_MAX_PER_MIN=8;
let chatSendTimes=[];
let onlineBootstrapped=false;
let onlineAuthReady=false; // verified Vercel/Telegram HttpOnly session, not browser Supabase auth
let browserRealtimeReady=false;
let serverReachable=true;
let lastServerContact=0;
let serverSchemaVersion=-1;
let onlineIntervalsStarted=false;

function initSupabase(){
  if(!sb){
    try{
      if(SUPABASE_URL&&SUPABASE_KEY){
        sb=createBrowserSupabase();
      }
    }catch(e){console.warn('supabase init failed',e);}
  }
  if(!onlineBootstrapped)bootstrapOnline();
  return sb;
}
async function ensureOnlineAuth(){
  try{
    if(window.__AUTOSYNDICATE_AUTHENTICATED__===true&&window.__AUTOSYNDICATE_SERVER_SESSION__?.playerId){
      onlineAuthReady=true;
    }else{
      const response=await serverFetch('/api/session',{method:'GET',credentials:'include',cache:'no-store'});
      const payload=await response.json().catch(()=>null);
      if(response.ok&&payload?.authenticated&&payload?.session?.playerId){
        window.__AUTOSYNDICATE_SERVER_SESSION__=payload.session;
        window.__AUTOSYNDICATE_AUTHENTICATED__=true;
        onlineAuthReady=true;
        if(/^tg_[0-9]{1,24}$/.test(payload.session.playerId))state.playerId=payload.session.playerId;
        if(payload.session.name)state.playerName=safeText(payload.session.name,'Гонщик',48);
        if(payload.session.username)state.playerUsername=safeText(payload.session.username,'',32).replace(/^@/,'').replace(/[^A-Za-z0-9_]/g,'');
      }else onlineAuthReady=false;
    }
    browserRealtimeReady=Boolean(window.__AUTOSYNDICATE_SUPABASE_SESSION__===true);
    if(sb&&!browserRealtimeReady){
      try{
        const {data}=await sb.auth.getSession();
        browserRealtimeReady=Boolean(data?.session?.user);
      }catch(_){ browserRealtimeReady=false; }
    }
    return onlineAuthReady;
  }catch(e){
    onlineAuthReady=false;
    console.warn('Secure server authentication failed.',e?.message||e);
    return false;
  }
}
async function bootstrapOnline(){
  if(onlineBootstrapped)return;
  onlineBootstrapped=true;
  await ensureOnlineAuth();
  if(sb&&browserRealtimeReady)subscribeMarket();
  if(onlineAuthReady){await checkServerSync();await syncPlayerProfile(true);loadPlayerLeaderboard();pollBackgroundClaims();}
  if(!onlineIntervalsStarted){onlineIntervalsStarted=true;setInterval(pollBackgroundClaims,90000);setInterval(()=>{if(onlineAuthReady){syncPlayerProfile();checkServerSync();}},30000);}
}
async function checkServerSync(){
  if(!onlineAuthReady)return false;
  try{
    const response=await serverFetch('/api/sync/status',{credentials:'include',cache:'no-store'}),payload=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(payload?.error||('sync status '+response.status));
    serverSchemaVersion=Number(payload?.schemaVersion)||0;
    return serverSchemaVersion>=12;
  }catch(e){console.warn('server sync status',e);return false;}
}
async function recoverServerSession(){
  try{
    const reauth=window.__AUTOSYNDICATE_REAUTH__;
    if(typeof reauth!=='function')return false;
    const ok=await reauth();
    onlineAuthReady=Boolean(ok&&window.__AUTOSYNDICATE_SERVER_SESSION__?.playerId);
    if(onlineAuthReady){
      const s=window.__AUTOSYNDICATE_SERVER_SESSION__;
      if(/^tg_[0-9]{1,24}$/.test(s.playerId))state.playerId=s.playerId;
      if(s.name)state.playerName=safeText(s.name,'Гонщик',48);
      if(s.username)state.playerUsername=safeText(s.username,'',32).replace(/^@/,'').replace(/[^A-Za-z0-9_]/g,'');
    }
    return onlineAuthReady;
  }catch(e){console.warn('Telegram session recovery failed',e);return false;}
}
let serverBackoffUntil=0;
async function serverFetch(input,init={}){
  const path=String(input||'');
  const bypassBackoff=/\/api\/(auth\/telegram|session)/.test(path);
  if(!bypassBackoff&&Date.now()<serverBackoffUntil){
    return new Response(JSON.stringify({ok:false,error:'online services temporarily unavailable',code:'BACKOFF'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }
  const run=async()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(input,{credentials:'include',cache:'no-store',...init,signal:init?.signal||controller.signal});
      serverReachable=true;lastServerContact=Date.now();
      if(response.status===503)serverBackoffUntil=Date.now()+5000;else if(response.ok)serverBackoffUntil=0;
      return response;
    }catch(e){serverReachable=false;serverBackoffUntil=Date.now()+5000;throw e;}
    finally{clearTimeout(timer);}
  };
  let response=await run();
  if(response.status===401){
    onlineAuthReady=false;
    if(await recoverServerSession())response=await run();
  }
  if(!response.ok&&response.status!==401&&response.status!==503){
    try{
      const detail=await response.clone().json();
      console.warn('AutoSyndicate API request failed',{path,status:response.status,code:detail?.code||'REQUEST_FAILED'});
    }catch(_){ }
  }
  return response;
}
async function requireOnlineWrite(feature='Онлайн-функция'){
  if(!onlineAuthReady){
    const ok=await ensureOnlineAuth()||await recoverServerSession();
    if(!ok){ showToast(feature+': требуется запуск через Telegram Mini App'); return false; }
  }
  // Presentation profile sync is best-effort. The Telegram principal/profile is already created
  // by /api/auth/telegram, so a temporary profile-sync failure must not disable friends/chat/etc.
  void syncPlayerProfile(true);
  return true;
}

function pollBackgroundClaims(){
  if(document.getElementById('screen-race')?.classList.contains('active')) return;
  if(!onlineAuthReady) return;
  claimSoldProceeds();
  claimBankTransfers();
  claimPvpResults();
}


/* ---------- РЕАЛЬНЫЕ ПРОФИЛИ ИГРОКОВ ---------- */
function playerProfilePayload(){
  return {
    id: state.playerId,
    name: safeText(state.playerName,'Гонщик',48),
    photo_url: state.playerPhoto || null,
    level: Number(state.level)||1,
    balance: Number(state.coins)||0,
    xp: Number(state.xp)||0,
    races: Number(state.stats?.races)||0,
    wins: Number(state.stats?.wins)||0,
    losses: Number(state.stats?.losses)||0,
    total_earned: Number(state.stats?.totalEarned)||0,
    owned_cars: Array.isArray(state.ownedCars)?state.ownedCars.slice(0,100):[],
    active_car_id: Number(state.activeCarId)||1,
    last_seen: new Date().toISOString()
  };
}
let profileSyncInFlight:any=null,lastProfileSyncAt=0;
async function syncPlayerProfile(force=false){
  if(!force && document.getElementById('screen-race')?.classList.contains('active')) return false;
  if(!state.playerId || !/^(tg_[0-9]{1,24})$/.test(state.playerId)) return false;
  if(profileSyncInFlight)return profileSyncInFlight;
  if(!force&&Date.now()-lastProfileSyncAt<20000)return true;
  profileSyncInFlight=(async()=>{try{
    const car=typeof carsDB!=='undefined'?carsDB.find(c=>c.id===state.activeCarId):null;
    const response=await serverFetch('/api/profile/sync',{
      method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({displayName:safeText(state.playerName,'Гонщик',48),photoUrl:state.playerPhoto||null,currentCarName:car?.name||null,activeCarId:Number(state.activeCarId)||1})
    });
    if(!response.ok)return false;
    lastProfileSyncAt=Date.now();return true;
  }catch(e){console.warn('player profile sync failed',e);return false;}finally{profileSyncInFlight=null;}})();
  return profileSyncInFlight;
}
async function loadPlayerLeaderboard(){
  try{
    if(!onlineAuthReady&&!await ensureOnlineAuth())return [];
    const response=await serverFetch('/api/profile/players',{credentials:'include',cache:'no-store'}),payload=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(payload?.error||('request rejected '+response.status));
    return Array.isArray(payload?.players)?payload.players:[];
  }catch(e){ console.warn('player leaderboard:',e?.message||e); return []; }
}
async function openPublicProfileByName(name){
  try{
    if(!onlineAuthReady&&!await ensureOnlineAuth()){showToast('Профиль доступен после входа через Telegram');return;}
    const clean=safeText(name,'',48); if(!clean) return;
    const response=await serverFetch('/api/profile/players?q='+encodeURIComponent(clean),{credentials:'include',cache:'no-store'}),payload=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(payload?.error||('request rejected '+response.status));
    if(payload?.player) openPublicProfileData(payload.player); else showToast('Профиль игрока не найден');
  }catch(e){ console.warn(e); showToast('Не удалось загрузить профиль'); }
}
/* ---------- РЫНОК ---------- */
let marketSub = 'browse';
function switchMarketSub(sub){
  marketSub = sub;
  document.getElementById('msub-browse').classList.toggle('active', sub==='browse');
  document.getElementById('msub-sell').classList.toggle('active', sub==='sell');
  document.getElementById('market-browse-wrap').style.display = sub==='browse' ? '' : 'none';
  document.getElementById('market-sell-wrap').style.display = sub==='sell' ? '' : 'none';
  if(sub==='sell') renderSellPicker();
}
function openMarket(){
  initSupabase();
  switchMarketSub(marketSub);
  refreshMarket();
}
function subscribeMarket(){
  if(!sb || marketChannel) return;
  marketChannel = sb.channel('market_cars_rt')
    .on('postgres_changes', {event:'*', schema:'public', table:'market_cars'}, ()=>{
      const scr=document.getElementById('screen-market');
      if(scr && scr.classList.contains('active')) refreshMarket();
    })
    .subscribe();
}
async function refreshMarket(){
  const statusEl = document.getElementById('market-status');
  if(statusEl) statusEl.innerText='Загрузка лотов…';
  try{
    const response=await serverFetch('/api/market',{credentials:'include',cache:'no-store'}),payload=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(payload?.error||('market rejected '+response.status));
    const data=Array.isArray(payload?.data)?payload.data:[];
    renderMarketList(data);
    if(statusEl) statusEl.innerText=data.length?'Активных лотов: '+data.length:'Рынок пуст';
  }catch(e){ console.warn(e); if(statusEl) statusEl.innerText='Не удалось загрузить рынок'; }
  if(onlineAuthReady){claimSoldProceeds();renderMyListings();}
}
function renderMarketList(rows){
  const c=document.getElementById('market-list'); if(!c) return;
  c.innerHTML='';
  if(!rows.length){ c.innerHTML='<div class="empty-note">Пока никто ничего не продаёт. Загляни позже!</div>'; return; }
  rows.forEach(r=>{
    const car=carsDB.find(x=>x.id===parseInt(r.car_id,10));
    if(!car) return;
    const isMine = r.seller_id===state.playerId;
    c.innerHTML += '<div class="listing-card">'+
      '<div class="listing-head"><span class="listing-name">'+escapeHtml(car.name)+'</span>'+(isMine?'<span class="mine-tag">Ваш лот</span>':'')+'</div>'+
      '<div class="listing-meta">Продавец: '+escapeHtml(r.seller_name||'Игрок')+' · '+car.tier+' · '+car.power+' л.с.</div>'+
      '<div class="listing-head"><span class="listing-price">'+fmt(r.price)+' </span>'+
      (isMine
        ? '<button class="sell-btn" onclick="cancelListing('+r.id+')">Снять с продажи</button>'
        : '<button class="btn btn-buy" style="width:auto;padding:8px 14px;" onclick="buyListing('+r.id+')">КУПИТЬ</button>')+
      '</div></div>';
  });
}
function renderSellPicker(){
  const box=document.getElementById('sell-picker'); if(!box) return;
  const mine = carsDB.filter(c=>state.ownedCars.includes(c.id));
  if(mine.length<=1){ box.innerHTML='<div class="empty-note">Нужна хотя бы одна запасная машина в гараже, чтобы её продать.</div>'; return; }
  let html='<div class="gauge-label" style="text-align:left;margin-bottom:6px;">Выбери машину на продажу</div>';
  mine.forEach(car=>{
    const statePrice = stateSellPrice(car);
    html += '<div class="sell-row"><div><div class="sell-row-name">'+car.name+'</div><div class="sell-row-sub">'+car.tier+'</div></div>'+
      '<div class="btn-row" style="width:auto;gap:6px;">'+
      '<button class="sell-btn market" onclick="promptListCar('+car.id+')">На рынок</button>'+
      '<button class="sell-btn state" onclick="sellToState('+car.id+')">Гос-во '+fmt(statePrice)+'</button>'+
      '</div></div>';
  });
  box.innerHTML = html;
}
function stateSellPrice(car){
  return Math.max(50, Math.round(car.price*0.35 * (0.6+getCondition(car.id)/100*0.4)));
}
function promptListCar(carId){
  const car=carsDB.find(c=>c.id===carId);
  const suggested = Math.round(car.price*0.85)||100;
  const input = window.prompt('Цена продажи для "'+car.name+'" (в игровой валюте). Ориентир: '+fmt(suggested), suggested);
  if(input===null) return;
  const price = parseInt(input,10);
  if(!price || price<=0 || price>MAX_MARKET_PRICE){ showToast('Цена должна быть от 1 до '+fmt(MAX_MARKET_PRICE)+' SYND'); return; }
  listCarForSale(carId, price);
}
async function listCarForSale(carId, price){
  if(!await requireOnlineWrite('Рынок')) return;
  if(!state.ownedCars.includes(carId)||state.ownedCars.length<=1)return;
  price=Math.trunc(Number(price));if(!Number.isFinite(price)||price<=0||price>MAX_MARKET_PRICE)return;
  const snapshot=typeof vehicleSnapshot==='function'?vehicleSnapshot(carId):{carId,upgrades:{engine:0,turbo:0,gearbox:0,tires:0},fuel:getFuel(carId),condition:getCondition(carId)};
  try{
    const response=await serverFetch('/api/market',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'list',price,vehicle:snapshot})});
    const payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(payload?.error||'market list rejected');
    state.ownedCars=state.ownedCars.filter(id=>id!==carId);if(state.activeCarId===carId)state.activeCarId=state.ownedCars[0];updateHeader();saveState();refreshMarket();renderSellPicker();
  }catch(e){console.warn(e);showToast('Не удалось выставить лот');}
}
async function cancelListing(id){
  if(!await requireOnlineWrite('Рынок'))return;
  try{const response=await serverFetch('/api/market',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel',listingId:Number(id)})});const payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(payload?.error||'market cancel rejected');const carId=parseInt(payload?.data?.car_id,10);if(carId&&!state.ownedCars.includes(carId))state.ownedCars.push(carId);saveState();refreshMarket();}catch(e){console.warn(e);showToast('Ошибка при снятии лота');}
}
async function buyListing(id){
  if(!await requireOnlineWrite('Рынок'))return;
  try{const detail=await serverFetch('/api/market?id='+encodeURIComponent(String(id)),{credentials:'include',cache:'no-store'}),detailPayload=await detail.json().catch(()=>null),row=detailPayload?.data;if(!detail.ok||!row||row.status!=='active')throw new Error('Лот недоступен');if(state.coins<Number(row.price||0)){showToast('Недостаточно денег');return;}const response=await serverFetch('/api/market',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'buy',listingId:Number(id)})});const payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(payload?.error||'market buy rejected');state.coins-=Number(row.price)||0;state.stats.totalSpent+=Number(row.price)||0;const carId=parseInt(row.car_id,10);if(carId&&!state.ownedCars.includes(carId))state.ownedCars.push(carId);updateHeader();saveState();refreshMarket();}catch(e){console.warn(e);showToast('Не удалось купить лот');}
}
function sellToState(carId){
  if(!state.ownedCars.includes(carId)) return;
  if(state.ownedCars.length<=1){ showToast('Нельзя продать последнюю машину'); return; }
  const car=carsDB.find(c=>c.id===carId);
  const price = stateSellPrice(car);
  if(!confirm('Продать "'+car.name+'" государству за '+fmt(price)+' ? Это заметно ниже рыночной цены — зато мгновенно.')) return;
  state.coins += price; state.stats.totalEarned += price;
  state.ownedCars = state.ownedCars.filter(id=>id!==carId);
  if(state.activeCarId===carId) state.activeCarId = state.ownedCars[0];
  delete state.upgrades[carId]; delete state.fuel[carId]; delete state.condition[carId];
  showToast(' Продано государству за '+fmt(price)+' ');
  updateHeader(); saveState(); renderSellPicker();
}
async function claimSoldProceeds(){
  if(!onlineAuthReady)return;
  try{
    const response=await serverFetch('/api/market?scope=mine',{credentials:'include',cache:'no-store'}),payload=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(payload?.error||('market mine rejected '+response.status));
    const data=Array.isArray(payload?.data)?payload.data:[];
    if(!Array.isArray(state.claimedSaleIds))state.claimedSaleIds=[];
    let credited=0,total=0;
    for(const row of data.filter(r=>r.status==='sold')){
      if(state.claimedSaleIds.includes(Number(row.id)))continue;
      try{
        const settleResponse=await serverFetch('/api/market',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'settle',listingId:Number(row.id)})});
        const settlePayload=await settleResponse.json().catch(()=>null),settled=settlePayload?.data;
        if(!settleResponse.ok||!settled?.id)continue;
        state.coins+=Number(row.price)||0;state.stats.totalEarned+=Number(row.price)||0;
        state.claimedSaleIds.push(Number(row.id));credited++;total+=Number(row.price)||0;
      }catch(_){ }
    }
    if(credited){showToast('Продано на рынке: +'+fmt(total)+' SYND');updateHeader();saveState();}
  }catch(e){console.warn('market proceeds',e);}
}
async function renderMyListings(){
  const c=document.getElementById('market-mine-list');if(!c||!onlineAuthReady)return;
  try{
    const response=await serverFetch('/api/market?scope=mine',{credentials:'include',cache:'no-store'}),payload=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(payload?.error||('market mine rejected '+response.status));
    const data=Array.isArray(payload?.data)?payload.data:[];c.innerHTML='';
    if(!data.length){c.innerHTML='<div class="empty-note">Вы пока ничего не продавали на рынке</div>';return;}
    const labels={active:'На продаже',sold:'Продано',settled:'Получено',cancelled:'Снято с продажи'};
    data.forEach(r=>{const car=carsDB.find(x=>x.id===parseInt(r.car_id,10));c.innerHTML+='<div class="listing-card"><div class="listing-head"><span class="listing-name">'+escapeHtml(car?car.name:'Машина #'+r.car_id)+'</span><span class="listing-meta">'+escapeHtml(labels[r.status]||r.status)+'</span></div><div class="listing-head"><span class="listing-price">'+fmt(r.price)+' SYND</span>'+(r.status==='active'?'<button class="sell-btn" onclick="cancelListing('+r.id+')">Снять</button>':'')+'</div></div>';});
  }catch(e){console.warn(e);c.innerHTML='<div class="empty-note">Не удалось синхронизировать ваши лоты</div>';}
}

/* ---------- ЧАТ ---------- */
let chatPollTimer=null;
let lastChatSnapshot='';
function openChat(){
  loadChatHistory();
  if(chatPollTimer)clearInterval(chatPollTimer);
  chatPollTimer=setInterval(()=>{
    if(document.getElementById('screen-chat')?.classList.contains('active'))loadChatHistory(true);
  },3000);
  setTimeout(()=>{ const i=document.getElementById('chat-input'); if(i) i.focus(); }, 200);
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function appendChatMessage(m){
  const c=document.getElementById('chat-messages'); if(!c) return;
  const isMe = m.player_id===state.playerId;
  const time = m.created_at ? new Date(m.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : '';
  const div=document.createElement('div');
  div.className='chat-msg'+(isMe?' me':'');
  const nm=escapeHtml(m.user_name||'Игрок');
  const profileTarget=m.player_id||m.user_name||'Игрок';
  div.innerHTML='<div class="chat-msg-name chat-profile-link" onclick="openPublicProfileByName('+JSON.stringify(profileTarget).replace(/"/g,'&quot;')+')">'+nm+' <span style="font-size:8px;color:var(--accent);">ПРОФИЛЬ</span></div><div class="chat-msg-text">'+escapeHtml(m.message)+'</div><div class="chat-msg-time">'+time+'</div>';
  c.appendChild(div);
}
async function loadChatHistory(silent=false){
  const statusEl=document.getElementById('chat-status');
  if(!onlineAuthReady&&!await ensureOnlineAuth()){
    if(statusEl&&!silent){statusEl.innerText='Войдите через Telegram Mini App';statusEl.classList.remove('on');}
    return;
  }
  if(statusEl&&!silent)statusEl.innerText='Синхронизация…';
  try{
    const response=await serverFetch('/api/social/chat',{method:'GET',credentials:'include',cache:'no-store'});
    const payload=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(payload?.error||('request rejected '+response.status));
    const msgs=Array.isArray(payload?.data)?payload.data:[];
    const snapshot=msgs.map(x=>x.id).join(',');
    const c=document.getElementById('chat-messages');
    if(c&&snapshot!==lastChatSnapshot){
      const wasNearBottom=c.scrollHeight-c.scrollTop-c.clientHeight<80;
      c.innerHTML='';msgs.forEach(appendChatMessage);lastChatSnapshot=snapshot;
      if(wasNearBottom||!silent)c.scrollTop=c.scrollHeight;
    }
    if(statusEl){statusEl.innerText='Онлайн';statusEl.classList.add('on');}
  }catch(e){
    if(statusEl){statusEl.innerText='Сервер чата недоступен';statusEl.classList.remove('on');}
    if(!silent)console.warn('chat history',e);
  }
}
function subscribeChat(){ /* v12 uses server polling so chat works even without browser Supabase auth. */ }
async function sendChatMessage(){
  if(!await requireOnlineWrite('Чат'))return;
  const input=document.getElementById('chat-input'),text=(input?.value||'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,300);if(!text)return;
  const now=Date.now();chatSendTimes=chatSendTimes.filter(ts=>now-ts<60000);
  if(chatSendTimes.length>=CHAT_MAX_PER_MIN || (chatSendTimes.length&&now-chatSendTimes[chatSendTimes.length-1]<CHAT_RATE_MS)){showToast('Не спамь: подожди пару секунд');haptic('warning');return;}
  try{
    const response=await serverFetch('/api/social/chat',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text})});
    const payload=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(payload?.error||('request rejected '+response.status));
    chatSendTimes.push(now);input.value='';haptic('light');await loadChatHistory(true);
  }catch(e){console.warn(e);showToast('Сообщение не отправлено');}
}

/* ==================== БАНК (ПЕРЕВОДЫ МЕЖДУ ИГРОКАМИ) ==================== */
function openBank(){
  initSupabase();
  document.getElementById('bank-my-id').innerText = state.playerId || '—';
  document.getElementById('bank-balance').innerText = fmt(state.coins);
  claimBankTransfers();
  renderBankLog();
}
function bankSentToday(){
  const dayAgo = Date.now()-24*60*60*1000;
  state.bankSentLog = (state.bankSentLog||[]).filter(l=>l.ts>dayAgo);
  return state.bankSentLog.reduce((s,l)=>s+l.amount,0);
}
function bankCooldownLeft(receiverId){
  const last = (state.bankSentLog||[]).filter(l=>l.to===receiverId).sort((a,b)=>b.ts-a.ts)[0];
  if(!last) return 0;
  const left = BANK_COOLDOWN_MS-(Date.now()-last.ts);
  return left>0 ? left : 0;
}
async function sendBankTransfer(){
  if(!await requireOnlineWrite('Банк')) return;
  const idInput=document.getElementById('bank-to-id');
  const amountInput=document.getElementById('bank-amount');
  const toId=(idInput?.value||'').trim();
  const amount=parseInt(amountInput?.value||'0',10);
  const statusEl=document.getElementById('bank-send-status');
  if(statusEl)statusEl.style.color='var(--accent)';
  if(!toId){ if(statusEl)statusEl.innerText='Укажи ID получателя'; return; }
  if(!/^tg_[0-9]{1,24}$/.test(toId)){if(statusEl)statusEl.innerText='Переводы доступны только Telegram-игрокам';return;}
  if(toId===state.playerId){ if(statusEl)statusEl.innerText='Нельзя перевести самому себе'; return; }
  if(!amount || amount<=0){ if(statusEl)statusEl.innerText='Некорректная сумма'; return; }
  if(amount>BANK_MAX_PER_TRANSFER){ if(statusEl)statusEl.innerText='Максимум за один перевод: '+fmt(BANK_MAX_PER_TRANSFER)+' SYND'; return; }
  if(amount>state.coins){ if(statusEl)statusEl.innerText='Недостаточно денег'; return; }
  const cooldown=bankCooldownLeft(toId);
  if(cooldown>0){ if(statusEl)statusEl.innerText='Этому игроку можно перевести снова через '+Math.ceil(cooldown/60000)+' мин.'; return; }
  const sentToday=bankSentToday();
  if(sentToday+amount>BANK_MAX_PER_DAY){ if(statusEl)statusEl.innerText='Дневной лимит переводов: '+fmt(BANK_MAX_PER_DAY)+' SYND'; return; }
  try{
    const response=await serverFetch('/api/bank',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',receiverId:toId,amount})});
    const payload=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(payload?.error||('bank rejected '+response.status));
    state.coins-=amount;state.stats.totalSpent+=amount;state.bankSentLog.push({to:toId,amount,ts:Date.now()});
    showToast('Отправлено '+fmt(amount)+' SYND игроку '+toId);
    if(statusEl){statusEl.style.color='var(--green)';statusEl.innerText='Перевод отправлен';}
    if(amountInput)amountInput.value='';if(idInput)idInput.value='';
    updateHeader();saveState();renderBankLog();const bal=document.getElementById('bank-balance');if(bal)bal.innerText=fmt(state.coins);
  }catch(e){console.warn(e);if(statusEl)statusEl.innerText='Перевод временно недоступен. Попробуйте позже.';}
}
async function claimBankTransfers(){
  if(!onlineAuthReady)return;
  try{
    const response=await serverFetch('/api/bank',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'claim'})});
    const payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(payload?.error||('bank claim rejected '+response.status));
    const rows=Array.isArray(payload?.data?.claimed)?payload.data.claimed:[],amount=Number(payload?.data?.amount)||0;
    if(!Array.isArray(state.claimedTransferIds))state.claimedTransferIds=[];
    rows.forEach(r=>{if(!state.claimedTransferIds.includes(Number(r.id)))state.claimedTransferIds.push(Number(r.id));});
    if(amount>0){state.coins+=amount;state.stats.totalEarned+=amount;showToast('Пришёл перевод: +'+fmt(amount)+' SYND');updateHeader();saveState();}
  }catch(e){console.warn('bank claim',e);}
}
async function renderBankLog(){
  const c=document.getElementById('bank-log');if(!c)return;
  if(!onlineAuthReady&&!await ensureOnlineAuth()){c.innerHTML='<div class="empty-note">Войдите через Telegram Mini App</div>';return;}
  try{
    const response=await serverFetch('/api/bank',{credentials:'include',cache:'no-store'}),payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(payload?.error||('bank history rejected '+response.status));
    const data=Array.isArray(payload?.data)?payload.data:[];c.innerHTML='';
    if(!data.length){c.innerHTML='<div class="empty-note">Переводов пока не было</div>';return;}
    data.slice(0,20).forEach(r=>{const outgoing=r.sender_id===state.playerId;c.innerHTML+='<div class="listing-card"><div class="listing-head"><span class="listing-name">'+(outgoing?'Отправлено → '+escapeHtml(r.receiver_id):'Получено ← '+escapeHtml(r.sender_name||r.sender_id))+'</span><span class="listing-price" style="color:'+(outgoing?'var(--accent)':'var(--green)')+'">'+(outgoing?'-':'+')+fmt(r.amount)+' SYND</span></div></div>';});
  }catch(e){console.warn(e);c.innerHTML='<div class="empty-note">История переводов временно недоступна</div>';}
}

/* ==================== PVP-ЗАЕЗДЫ С ИГРОКАМИ (асинхронные вызовы) ==================== */
function openPvp(){
  claimPvpResults();
  refreshPvpList();
}
async function pvpApi(method='GET',body=null){
  if(!onlineAuthReady&&!await ensureOnlineAuth())throw new Error('Требуется вход через Telegram Mini App');
  const opts={method,credentials:'include',cache:'no-store',headers:{}};
  if(body!==null){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
  const response=await serverFetch('/api/pvp',opts),payload=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(payload?.error||('pvp rejected '+response.status));
  return payload;
}
async function refreshPvpList(){
  const c=document.getElementById('pvp-list'); if(!c) return;
  try{
    const payload=await pvpApi('GET'),data=Array.isArray(payload?.open)?payload.open:[];
    c.innerHTML='';
    if(!data.length){c.innerHTML='<div class="empty-note">Открытых вызовов нет. Создай свой!</div>';return;}
    data.forEach(r=>{const isMine=r.challenger_id===state.playerId;c.innerHTML+='<div class="listing-card"><div class="listing-head"><span class="listing-name">'+escapeHtml(r.challenger_name||'Игрок')+'</span>'+(isMine?'<span class="mine-tag">Твой вызов</span>':'')+'</div><div class="listing-meta">Мощность соперника: '+r.power+' л.с.</div><div class="listing-head"><span class="listing-price">Ставка '+fmt(r.stake)+' SYND</span>'+(isMine?'<button class="sell-btn" onclick="cancelPvpChallenge('+r.id+')">Отменить</button>':'<button class="btn btn-buy" style="width:auto;padding:8px 14px;" onclick="acceptPvpChallenge('+r.id+')">ПРИНЯТЬ ВЫЗОВ</button>')+'</div></div>';});
  }catch(e){console.warn(e);c.innerHTML='<div class="empty-note">Не удалось загрузить вызовы</div>';}
}
async function postPvpChallenge(){
  if(!await requireOnlineWrite('PvP'))return;
  const car=carsDB.find(c=>c.id===state.activeCarId),stakeInput=document.getElementById('pvp-stake-input'),stake=parseInt(stakeInput?.value||'0',10);
  if(!stake||stake<=0){showToast('Укажи ставку');return;}if(stake>MAX_PVP_STAKE){showToast('Максимальная ставка: '+fmt(MAX_PVP_STAKE)+' SYND');return;}if(stake>state.coins){showToast('Недостаточно денег на ставку');return;}
  try{
    await pvpApi('POST',{action:'create',power:getEffectivePower(car),stake});
    state.coins-=stake;state.stats.totalSpent+=stake;showToast('Вызов создан. Ставка '+fmt(stake)+' SYND заморожена');updateHeader();saveState();refreshPvpList();if(stakeInput)stakeInput.value='';
  }catch(e){console.warn(e);showToast('Не удалось создать вызов');}
}
async function cancelPvpChallenge(id){
  if(!await requireOnlineWrite('PvP'))return;
  try{const payload=await pvpApi('POST',{action:'cancel',id:Number(id)}),row=payload?.data;if(!row?.id)throw new Error('cancel rejected');state.coins+=Number(row.stake)||0;showToast('Вызов отменён, ставка возвращена');updateHeader();saveState();refreshPvpList();}catch(e){console.warn(e);showToast('Ошибка отмены');}
}
async function acceptPvpChallenge(id){
  if(!await requireOnlineWrite('PvP'))return;
  try{
    const view=await pvpApi('GET'),row=(Array.isArray(view?.open)?view.open:[]).find(r=>Number(r.id)===Number(id));if(!row){showToast('Вызов уже недоступен');refreshPvpList();return;}if(row.challenger_id===state.playerId){showToast('Нельзя принять свой вызов');return;}if(state.coins<Number(row.stake||0)){showToast('Недостаточно денег для ставки');return;}
    const payload=await pvpApi('POST',{action:'accept',id:Number(id)}),accepted=payload?.data;if(!accepted?.id)throw new Error('accept rejected');prepareRace(accepted,'pvp');
  }catch(e){console.warn(e);showToast('Не удалось принять вызов');}
}
async function resolvePvpChallenge(row,accepterWon,reward){
  if(!row||!await requireOnlineWrite('PvP'))return;
  try{await pvpApi('POST',{action:'resolve',id:Number(row.id),winnerId:accepterWon?state.playerId:row.challenger_id});}catch(e){console.warn(e);}
}
async function claimPvpResults(){
  if(!onlineAuthReady)return;
  try{
    const payload=await pvpApi('GET'),data=Array.isArray(payload?.resolved)?payload.resolved:[];
    if(!Array.isArray(state.claimedPvpIds))state.claimedPvpIds=[];let changed=false;
    for(const row of data){
      if(state.claimedPvpIds.includes(Number(row.id)))continue;
      try{const settled=await pvpApi('POST',{action:'settle',id:Number(row.id)});if(!settled?.data?.id)continue;}catch(_){continue;}
      state.claimedPvpIds.push(Number(row.id));
      if(row.winner_id===state.playerId){const winnings=(Number(row.stake)||0)*2;state.coins+=winnings;state.stats.totalEarned+=winnings;showToast('Ты выиграл PvP: +'+fmt(winnings)+' SYND');}else showToast('Соперник выиграл PvP. Ставка потеряна.');
      changed=true;
    }
    if(changed){updateHeader();saveState();}
  }catch(e){console.warn('pvp claim',e);}
}


/* ===== migrated from carbon_expansion_v8.js ===== */
/* ==================== CARBON DISTRICT 8.0 ====================
   Race dynamics, rival profiles, vehicle-preserving market, plates,
   cases, referral UX, save recovery and UI polish.
*/
(function(){
  const V8_VERSION=8;
  const BACKUP_KEYS=['autosyndicate_save_v8_b1','autosyndicate_save_v8_b2','autosyndicate_save_v8_b3'];
  const RARITY_ORDER={common:0,rare:1,epic:2,legendary:3,mythic:4};
  const RARITY_LABEL={common:'COMMON',rare:'RARE',epic:'EPIC',legendary:'LEGENDARY',mythic:'MYTHIC'};
  const PART_LABEL={engine:'Двигатель',turbo:'Турбо',gearbox:'КПП',tires:'Шины'};

  function svgIcon(name,cls='as-icon'){
    const p={
      map:'<path d="M4 6.5 9 4l6 2.5L20 4v13.5L15 20l-6-2.5L4 20V6.5Z"/><path d="M9 4v13.5M15 6.5V20"/>',
      list:'<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
      brief:'<rect x="5" y="7" width="14" height="12" rx="2"/><path d="M9 7V5h6v2M5 12h14"/>',
      trophy:'<path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1a4 4 0 0 0 4 4M16 6h3v1a4 4 0 0 1-4 4M12 12v4M8 20h8M9 16h6"/>',
      case:'<path d="M4 9h16v11H4z"/><path d="M3 5h18v4H3zM12 5v15M8 5c0-2 4-2 4 0M16 5c0-2-4-2-4 0"/>',
      chart:'<path d="M4 19V5M4 19h16"/><path d="m7 15 3-4 3 2 5-7"/>',
      calendar:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 9h16"/>',
      tag:'<path d="M20 13 13 20 4 11V4h7l9 9Z"/><circle cx="8" cy="8" r="1"/>',
      chat:'<path d="M4 5h16v11H9l-5 4V5Z"/>',
      bank:'<path d="m3 9 9-5 9 5M5 10v7M9 10v7M15 10v7M19 10v7M3 20h18"/>',
      gear:'<circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7L10.5 2h-3L6.8 4l-1.7.7-1.9-.9L1.1 5.9 2 7.8l-.7 1.7-2 .7v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7 2-.7Z" transform="translate(2.5 0) scale(.8)"/>',
      save:'<path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
      plate:'<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10h10M7 14h6"/>',
      users:'<circle cx="9" cy="8" r="3"/><path d="M3 20c.6-4 2.5-6 6-6s5.4 2 6 6M16 6a3 3 0 0 1 0 6M17 14c2.3.4 3.5 2.2 4 5"/>',
      fuel:'<path d="M5 4h8v16H5zM7 8h4M13 7h3l2 3v7a2 2 0 0 0 4 0v-6l-2-2"/>',
      wrench:'<path d="M14 6a4 4 0 0 0-5 5L3 17l4 4 6-6a4 4 0 0 0 5-5l-3 3-4-4 3-3Z"/>',
      arrow:'<path d="M12 20V5M6 11l6-6 6 6"/>',
      bolt:'<path d="m13 2-8 12h6l-1 8 9-13h-6l0-7Z"/>',
      shield:'<path d="M12 3 20 6v6c0 5-3.4 8-8 10-4.6-2-8-5-8-10V6l8-3Z"/>',
      copy:'<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5H5v11h3"/>',
      coin:'<circle cx="12" cy="12" r="8"/><path d="M9 9.5c0-1.2 1.1-2 3-2s3 .8 3 2-1 1.8-3 2-3 .8-3 2 1.1 2 3 2 3-.8 3-2M12 5.5v13"/>',
      tune:'<path d="M4 7h9M17 7h3M11 4v6M4 17h3M11 17h9M9 14v6"/>',
      car:'<path d="m5 13 2-5h10l2 5"/><path d="M3 13h18v5H3zM6 18v2M18 18v2M6 15h.01M18 15h.01"/>'
    };
    return '<svg class="'+cls+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(p[name]||p.car)+'</svg>';
  }
  window.svgIcon=svgIcon;

  function sanitizeUiText(v){
    return String(v??'').replace(/[\u{1F000}-\u{1FAFF}]/gu,'').replace(/[\u2600-\u263F\u2700-\u27BF]/g,'').replace(/\s{2,}/g,' ').trim();
  }

  /* ---------- SAVE RECOVERY / NEW STATE ---------- */
  const baseDefaultState=defaultState;
  const baseNormalizeState=normalizeState;
  const baseSaveState=saveState;
  defaultState=function(){
    const s=baseDefaultState();
    return Object.assign(s,{
      saveVersion:V8_VERSION,
      plateInventory:[],installedPlates:{},plateRolls:0,
      casePity:{bronze:0,silver:0,gold:0,goldCar:0},caseHistory:[],caseOpening:false,
      tuningHistory:{},vehicleInstances:{},marketEscrow:{},
      rivalRecords:{},referral:{code:'',bound:false,startBonusClaimed:false,firstRaceBonusClaimed:false,totalClaimed:0,invites:0,earned:0},
      dataRevision:0,lastIntegritySave:0
    });
  };
  function normalizePlate(p){
    if(!p||typeof p!=='object')return null;
    const text=safeText(p.text,'',18).toUpperCase(); if(!text)return null;
    const rarity=['common','rare','epic','legendary','mythic'].includes(p.rarity)?p.rarity:'common';
    return {uid:safeText(p.uid,'plate_'+Math.random().toString(36).slice(2),48),text,rarity,series:safeText(p.series,'STANDARD',24),value:intNumber(p.value,100,0,2_000_000),limited:p.limited===true,createdAt:intNumber(p.createdAt,Date.now(),0,Date.now()+86400000)};
  }
  normalizeState=function(raw){
    const out=baseNormalizeState(raw),s=plainObject(raw)?raw:{};
    out.saveVersion=V8_VERSION;
    out.plateInventory=Array.isArray(s.plateInventory)?s.plateInventory.slice(0,300).map(normalizePlate).filter(Boolean):[];
    out.installedPlates={};
    if(plainObject(s.installedPlates))Object.keys(s.installedPlates).slice(0,100).forEach(k=>{const v=safeText(s.installedPlates[k],'',48);if(/^\d{1,6}$/.test(k)&&v)out.installedPlates[k]=v;});
    out.plateRolls=intNumber(s.plateRolls,0,0,1e7);
    out.casePity={bronze:0,silver:0,gold:0,goldCar:0,...(plainObject(s.casePity)?s.casePity:{})};
    Object.keys(out.casePity).forEach(k=>out.casePity[k]=intNumber(out.casePity[k],0,0,100000));
    out.caseHistory=Array.isArray(s.caseHistory)?s.caseHistory.slice(-60).filter(plainObject).map(x=>({ts:intNumber(x.ts,Date.now(),0,Date.now()+86400000),caseId:safeText(x.caseId,'unknown',20),label:safeText(x.label,'Награда',80),rarity:['common','rare','epic','legendary','mythic'].includes(x.rarity)?x.rarity:'common',type:safeText(x.type,'unknown',20)})):[];
    out.tuningHistory={};
    if(plainObject(s.tuningHistory))Object.keys(s.tuningHistory).slice(0,100).forEach(k=>{if(!/^\d{1,6}$/.test(k)||!Array.isArray(s.tuningHistory[k]))return;out.tuningHistory[k]=s.tuningHistory[k].slice(-40).filter(plainObject).map(x=>({ts:intNumber(x.ts,Date.now(),0,Date.now()+86400000),part:safeText(x.part,'part',16),level:intNumber(x.level,0,0,5),price:intNumber(x.price,0,0,5_000_000),source:safeText(x.source,'shop',20)}));});
    out.marketEscrow=plainObject(s.marketEscrow)?s.marketEscrow:{};
    out.rivalRecords={};
    if(plainObject(s.rivalRecords))Object.keys(s.rivalRecords).slice(0,100).forEach(k=>{const x=s.rivalRecords[k];if(plainObject(x))out.rivalRecords[safeText(k,'',40)]={wins:intNumber(x.wins,0,0,1e6),losses:intNumber(x.losses,0,0,1e6),lastResult:safeText(x.lastResult,'',12)};});
    const rr=plainObject(s.referral)?s.referral:{};
    out.referral={code:safeText(rr.code,'',20),bound:rr.bound===true,startBonusClaimed:rr.startBonusClaimed===true,firstRaceBonusClaimed:rr.firstRaceBonusClaimed===true,totalClaimed:intNumber(rr.totalClaimed,0,0,1e12),invites:intNumber(rr.invites,0,0,1e9),earned:intNumber(rr.earned,0,0,1e12)};
    out.caseOpening=false;out.dataRevision=intNumber(s.dataRevision,0,0,1e9);out.lastIntegritySave=intNumber(s.lastIntegritySave,0,0,Date.now()+86400000);
    return out;
  };
  saveState=function(){
    try{
      state.saveVersion=V8_VERSION;state.dataRevision=(Number(state.dataRevision)||0)+1;state.lastIntegritySave=Date.now();
      const current=localStorage.getItem(SAVE_KEY);
      if(current && current.length<=MAX_SAVE_BYTES){
        const prev1=localStorage.getItem(BACKUP_KEYS[0]),prev2=localStorage.getItem(BACKUP_KEYS[1]);
        if(prev2)localStorage.setItem(BACKUP_KEYS[2],prev2);
        if(prev1)localStorage.setItem(BACKUP_KEYS[1],prev1);
        localStorage.setItem(BACKUP_KEYS[0],current);
      }
    }catch(_){ }
    baseSaveState();
  };
  loadState=function(){
    const candidates=[SAVE_KEY,...BACKUP_KEYS,...LEGACY_SAVE_KEYS];
    for(const key of candidates){
      try{
        const raw=localStorage.getItem(key);if(!raw||raw.length>MAX_SAVE_BYTES)continue;
        const parsed=JSON.parse(raw);state=normalizeState(parsed);localStorage.setItem(SAVE_KEY,JSON.stringify(state));return;
      }catch(_){ }
    }
    state=defaultState();
  };

  /* ---------- VEHICLE / TUNING HELPERS ---------- */
  function tuningInstalledValue(carId){
    const car=carsDB.find(c=>c.id===Number(carId));if(!car)return 0;
    const u=getUpg(car.id);let total=0;
    TUNE_TYPES.forEach(t=>{for(let i=0;i<Math.min(5,Number(u[t.key])||0);i++)total+=tuneStagePrice(car,i);});
    return total;
  }
  function buildRating(carId){
    const u=getUpg(Number(carId));const sum=TUNE_TYPES.reduce((a,t)=>a+(Number(u[t.key])||0),0);
    return Math.round(Math.min(100,(sum/20)*88+(Number(u.gearbox)||0)*1.6+(Number(u.tires)||0)*.8));
  }
  function activePlate(carId){
    const uid=state.installedPlates?.[String(carId)];return state.plateInventory?.find(p=>p.uid===uid)||null;
  }
  function vehicleSnapshot(carId){
    const id=Number(carId),car=carsDB.find(c=>c.id===id);if(!car)return null;
    return {version:2,carId:id,upgrades:{...getUpg(id)},fuel:getFuel(id),condition:getCondition(id),plate:activePlate(id),tuningHistory:(state.tuningHistory?.[id]||[]).slice(-30),effectivePower:getEffectivePower(car),tuningValue:tuningInstalledValue(id),buildRating:buildRating(id)};
  }
  function applyVehicleSnapshot(snap){
    if(!snap||!carsDB.some(c=>c.id===Number(snap.carId)))return false;
    const id=Number(snap.carId);if(!state.ownedCars.includes(id))state.ownedCars.push(id);
    state.upgrades[id]={engine:0,turbo:0,gearbox:0,tires:0,...(plainObject(snap.upgrades)?snap.upgrades:{})};
    TUNE_TYPES.forEach(t=>state.upgrades[id][t.key]=intNumber(state.upgrades[id][t.key],0,0,5));
    state.fuel[id]=finiteNumber(snap.fuel,100,0,100);state.condition[id]=finiteNumber(snap.condition,100,0,100);
    state.tuningHistory[id]=Array.isArray(snap.tuningHistory)?snap.tuningHistory.slice(-30):[];
    let p=normalizePlate(snap.plate);
    if(p){
      if(state.plateInventory.some(x=>x.uid===p.uid)){p={...p,uid:p.uid+'_m'+Date.now().toString(36)};}
      Object.keys(state.installedPlates||{}).forEach(k=>{if(state.installedPlates[k]===p.uid)delete state.installedPlates[k];});
      state.plateInventory.push(p);state.installedPlates[String(id)]=p.uid;
    }
    return true;
  }
  window.vehicleSnapshot=vehicleSnapshot;window.applyVehicleSnapshot=applyVehicleSnapshot;

  function escrowCarIds(){return new Set(Object.values(state.marketEscrow||{}).map(v=>Number(v&&v.carId)).filter(Number.isFinite));}
  const baseBuyCar=buyCar;
  buyCar=function(carId){
    if(escrowCarIds().has(Number(carId))){showToast('Эта модель сейчас находится в рыночном лоте');return;}
    const before=state.ownedCars.includes(carId);baseBuyCar(carId);
    if(!before&&state.ownedCars.includes(carId)){state.tuningHistory[carId]=state.tuningHistory[carId]||[];saveState();}
  };
  const baseUpgradeTune=upgradeTune;
  upgradeTune=function(carId,key){
    const before=Number(getUpg(carId)[key]||0),car=carsDB.find(c=>c.id===carId);const price=car&&before<5?tuneStagePrice(car,before):0;
    baseUpgradeTune(carId,key);
    const after=Number(getUpg(carId)[key]||0);
    if(after>before){state.tuningHistory[carId]=state.tuningHistory[carId]||[];state.tuningHistory[carId].push({ts:Date.now(),part:key,level:after,price,source:'shop'});state.tuningHistory[carId]=state.tuningHistory[carId].slice(-40);saveState();openTune(carId);}
  };

  openTune=function(carId){
    state.tuneTargetId=carId;const car=carsDB.find(c=>c.id===carId);if(!car)return;
    const upg=getUpg(carId),currentPower=getEffectivePower(car),rating=buildRating(carId),value=tuningInstalledValue(carId),profile=raceTuneProfile(car);
    const title=document.getElementById('tune-car-title');if(title)title.innerText='Тюнинг · '+car.name;
    const c=document.getElementById('tune-list');if(!c)return;
    const bars=[['Мощность',Math.min(100,currentPower/1500*100),currentPower+' л.с.'],['Разгон',Math.min(100,profile.accel/2.1*100),profile.accel.toFixed(2)+'x'],['Окно SHIFT',Math.min(100,profile.yellowWidth/.12*100),Math.round(profile.yellowWidth*200)+'%'],['Сцепление',Math.min(100,profile.launchGrip*100),Math.round(profile.launchGrip*100)+'%']];
    let html='<div class="tune-overview"><div class="tune-overview-top"><div><span>РЕЙТИНГ СБОРКИ</span><b>'+rating+'/100</b></div><div><span>ВЛОЖЕНО</span><b>'+fmt(value)+' SYND</b></div></div><div class="tune-chart">'+bars.map(x=>'<div class="tune-chart-row"><span>'+x[0]+'</span><div><i style="width:'+x[1]+'%"></i></div><b>'+x[2]+'</b></div>').join('')+'</div></div>';
    TUNE_TYPES.forEach(t=>{
      const lvl=Number(upg[t.key])||0,maxed=lvl>=5,price=maxed?0:tuneStagePrice(car,lvl),can=state.coins>=price;
      const test={...upg};if(!maxed)test[t.key]=lvl+1;
      let before=currentPower,after=before;
      if(!maxed){let mult=1;TUNE_TYPES.forEach(q=>{const l=Number(test[q.key])||0;for(let i=0;i<l;i++)mult+=q.hpPerStage[i];});const cond=getCondition(carId);if(cond<40)mult*=.85;else if(cond<70)mult*=.93;after=Math.round(car.power*mult);}
      const dots=Array.from({length:5},(_,i)=>'<i class="tune-dot '+(i<lvl?'on':'')+'"></i>').join('');
      const note=t.key==='gearbox'?'Расширяет жёлтое/зелёное окно, ускоряет набор оборотов и снижает штраф ошибки.':t.desc;
      html+='<div class="tune-v8-card"><div class="tune-v8-head"><div class="tune-part-icon">'+svgIcon(t.key==='gearbox'?'gear':t.key==='tires'?'car':t.key==='engine'?'wrench':'bolt')+'</div><div><b>'+t.name+'</b><span>'+note+'</span></div><strong>УР. '+lvl+'/5</strong></div><div class="tune-dots">'+dots+'</div><div class="tune-compare"><span>Сейчас <b>'+before+' л.с.</b></span><span>После <b>'+(maxed?'МАКС.':after+' л.с.')+'</b></span></div><button class="tune-btn '+(maxed?'maxed':'')+'" '+(maxed||!can?'disabled':'')+' onclick="upgradeTune('+carId+',\''+t.key+'\')">'+(maxed?'МАКСИМУМ':fmt(price)+' SYND · УСТАНОВИТЬ')+'</button></div>';
    });
    const hist=(state.tuningHistory?.[carId]||[]).slice().reverse();
    html+='<div class="tune-history"><div class="v8-section-head"><b>ИСТОРИЯ СБОРКИ</b><span>'+hist.length+' операций</span></div>'+(hist.length?hist.slice(0,8).map(x=>'<div class="history-row"><span>'+PART_LABEL[x.part]+' · УР. '+x.level+'</span><b>'+fmt(x.price)+' SYND</b></div>').join(''):'<div class="empty-note">Установок пока нет</div>')+'</div>';
    c.innerHTML=html;
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById('screen-tune').classList.add('active');document.getElementById('main-scroll').scrollTop=0;
  };

  /* ---------- PLATES ---------- */
  const PLATE_POOLS={
    common:['A124BC','M381KT','K052PA','B917EP','C404AX','T218OP'],
    rare:['X777XX','A001AA','M777MM','P555PP','O009OO','K888KK'],
    epic:['777 CARBON','RACE 01','NIGHT 7','BOSS 66','SYN 777'],
    legendary:['X777XX 77','A001AA 77','M777MM 77','KING 001'],
    mythic:['SYND 001','CARBON 1','BLACK 777']
  };
  function secureRandom(){if(globalThis.crypto?.getRandomValues){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]/4294967296;}return Math.random();}
  function pick(arr){return arr[Math.floor(secureRandom()*arr.length)];}
  function rollRarity(weights){let r=secureRandom()*100,acc=0;for(const [rar,w] of weights){acc+=w;if(r<acc)return rar;}return weights[weights.length-1][0];}
  function makePlate(rarity){
    const text=pick(PLATE_POOLS[rarity]||PLATE_POOLS.common),limited=rarity==='mythic'||(rarity==='legendary'&&secureRandom()<.25);
    return {uid:'plate_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8),text,rarity,series:limited?'LIMITED '+new Date().getFullYear():(rarity==='common'?'STANDARD':'BLACK SERIES'),value:{common:120,rare:800,epic:3500,legendary:12000,mythic:30000}[rarity],limited,createdAt:Date.now()};
  }
  function renderPlateScreen(carId){
    ensureV8Screens();const id=Number(carId||state.activeCarId),car=carsDB.find(c=>c.id===id);if(!car)return;
    const root=document.getElementById('plate-content'),installed=activePlate(id),inv=state.plateInventory||[];
    root.innerHTML='<div class="plate-hero"><div><span>АВТОМОБИЛЬ</span><b>'+escapeHtml(car.name)+'</b></div><div class="plate-preview '+(installed?'rar-'+installed.rarity:'')+'">'+(installed?escapeHtml(installed.text):'БЕЗ НОМЕРА')+'</div>'+(installed?'<small>'+RARITY_LABEL[installed.rarity]+' · '+escapeHtml(installed.series)+'</small>':'<small>Установи номер из коллекции</small>')+'</div><div class="plate-roll-card"><div><b>ПРОКРУТКА НОМЕРОВ</b><span>Обычные, редкие, блатные и лимитированные серии.</span></div><button class="btn btn-gold" '+(state.coins<650?'disabled':'')+' onclick="spinPlate('+id+')">650 SYND · КРУТИТЬ</button></div><div class="v8-section-head"><b>КОЛЛЕКЦИЯ</b><span>'+inv.length+' шт.</span></div><div class="plate-grid">'+(inv.length?inv.slice().sort((a,b)=>RARITY_ORDER[b.rarity]-RARITY_ORDER[a.rarity]).map(p=>'<div class="plate-card rar-'+p.rarity+' '+(installed?.uid===p.uid?'installed':'')+'"><div class="plate-card-number">'+escapeHtml(p.text)+'</div><div class="plate-card-meta"><span>'+RARITY_LABEL[p.rarity]+'</span><span>'+escapeHtml(p.series)+'</span></div><button class="btn btn-ghost" onclick="installPlate('+id+',\''+p.uid+'\')">'+(installed?.uid===p.uid?'УСТАНОВЛЕН':'УСТАНОВИТЬ')+'</button></div>').join(''):'<div class="empty-note">Коллекция пуста. Прокрути первый номер.</div>')+'</div>';
  }
  window.openPlateGarage=function(carId){const id=Number(carId||state.activeCarId);state.tuneTargetId=id;ensureV8Screens();switchTab('plates');renderPlateScreen(id);};
  window.installPlate=function(carId,uid){if(!(state.plateInventory||[]).some(p=>p.uid===uid))return;Object.keys(state.installedPlates||{}).forEach(k=>{if(state.installedPlates[k]===uid)delete state.installedPlates[k];});state.installedPlates[String(carId)]=uid;saveState();renderPlateScreen(carId);showToast('Номер установлен');};
  window.spinPlate=function(carId){
    if(state.coins<650){showToast('Недостаточно SYND');return;}state.coins-=650;state.stats.totalSpent+=650;state.plateRolls=(state.plateRolls||0)+1;
    let rarity=rollRarity([['common',64],['rare',25],['epic',8.5],['legendary',2.2],['mythic',.3]]);
    if(state.plateRolls%25===0&&RARITY_ORDER[rarity]<2)rarity='epic';
    const p=makePlate(rarity);state.plateInventory.push(p);updateHeader();saveState();renderPlateScreen(carId);showToast(p.text+' · '+RARITY_LABEL[p.rarity]);
  };

  const baseOpenDetail=openDetail;
  openDetail=function(carId){
    baseOpenDetail(carId);if(!state.ownedCars.includes(carId))return;const root=document.getElementById('detail-content');if(!root)return;
    const p=activePlate(carId),car=carsDB.find(c=>c.id===carId);const box=document.createElement('div');box.className='vehicle-identity-card';box.innerHTML='<div><span>ГОСНОМЕР</span><b>'+(p?escapeHtml(p.text):'НЕ УСТАНОВЛЕН')+'</b><small>'+(p?RARITY_LABEL[p.rarity]+' · '+escapeHtml(p.series):'Открой коллекцию номеров')+'</small></div><button class="btn btn-ghost" onclick="openPlateGarage('+carId+')">'+svgIcon('plate')+' НОМЕРА</button></div><div class="vehicle-value-row"><span>Стоимость тюнинга</span><b>'+fmt(tuningInstalledValue(carId))+' SYND</b><span>Build score</span><b>'+buildRating(carId)+'/100</b></div>';
    root.appendChild(box);
    const tuneBtn=root.querySelector('button[onclick^="openTune"]');if(tuneBtn)tuneBtn.innerHTML=svgIcon('wrench')+' ТЮНИНГ';
  };

  /* ---------- RIVALS ---------- */
  const EXTRA_RIVALS=[
    {id:10,name:'Marlow',power:390,reward:450,unlockLevel:1,car:'Honda Civic EK9',rating:71,style:'Поздний тормоз',favoriteTracks:['Промзона','Тоннель'],wins:34,losses:19,avatar:'MR',taunt:'Твоя машина выглядит быстро. Жаль, что водитель нет.',preLines:['Не держи меня на старте.','Я вижу, где ты теряешь время.'],winLine:'Слишком много шума, слишком мало скорости.',loseLine:'Ладно. Этот старт был твоим.'},
    {id:11,name:'Kira',power:520,reward:760,unlockLevel:2,car:'Mazda RX-7 FD',rating:76,style:'Техничный',favoriteTracks:['Старая эстакада','Портовый обход'],wins:58,losses:21,avatar:'KR',taunt:'Переключайся аккуратно. Я на ошибках не прощаю.',preLines:['Смотри на тахометр, не на меня.','Один плохой SHIFT и я исчезну.'],winLine:'Ты подарил мне слишком много метров.',loseLine:'Чисто. Признаю.'},
    {id:12,name:'Rook',power:680,reward:1250,unlockLevel:4,car:'BMW M3 E46',rating:82,style:'Агрессивный',favoriteTracks:['Ночной проспект','Промзона'],wins:91,losses:37,avatar:'RK',taunt:'Я не обгоняю. Я забираю полосу.',preLines:['Не моргай на старте.','Сегодня тесно будет именно тебе.'],winLine:'Давление выдерживают не все.',loseLine:'В этот раз ты выдержал.'},
    {id:13,name:'Vanta',power:810,reward:2250,unlockLevel:6,car:'Nissan Skyline R34',rating:87,style:'Контратака',favoriteTracks:['Тоннель','Портовый обход'],wins:126,losses:42,avatar:'VT',taunt:'Выходишь вперёд — я становлюсь быстрее.',preLines:['Дай мне повод догонять.','Первый обгон ничего не значит.'],winLine:'Я предупреждал: впереди меня ехать тяжело.',loseLine:'Редко кто удерживает позицию до конца.'},
    {id:14,name:'Sable',power:990,reward:4100,unlockLevel:8,car:'Porsche 911 Turbo S',rating:92,style:'Холодный темп',favoriteTracks:['Старая эстакада','Ночной проспект'],wins:202,losses:39,avatar:'SB',taunt:'У тебя пять передач, чтобы доказать, что ты здесь не случайно.',preLines:['Проверим твою КПП.','Я не спешу. Мне хватает темпа.'],winLine:'Ровный темп всегда побеждает панику.',loseLine:'Твой темп был лучше. Запомню.'},
    {id:15,name:'Knox',power:1180,reward:7200,unlockLevel:11,car:'McLaren 720S',rating:96,style:'Максимальное давление',favoriteTracks:['Промзона','Тоннель'],wins:331,losses:54,avatar:'KX',taunt:'Когда увидишь меня сбоку, уже будет поздно.',preLines:['Не оставляй мне полметра.','Вторая половина трассы моя.'],winLine:'Ты оставил дверь открытой.',loseLine:'Закрыл всё. Нечего сказать.',boss:true},
    {id:16,name:'Cipher',power:1430,reward:12500,unlockLevel:15,car:'Bugatti Chiron',rating:99,style:'Безошибочный',favoriteTracks:['Ночной проспект','Портовый обход'],wins:497,losses:31,avatar:'CP',taunt:'Я считаю твои ошибки до старта.',preLines:['Шанс у тебя есть. Маленький.','Сделай идеальный старт. Он тебе понадобится.'],winLine:'Ошибка номер один была выйти против меня.',loseLine:'Без ошибок. Именно так и надо.',boss:true},
    {id:'npc_041',name:'Helix',power:245,reward:260,unlockLevel:1,car:'Volkswagen Golf Mk2',rating:59,style:'Чистый старт',favoriteTracks:['Промзона'],wins:21,losses:26,avatar:'HX',taunt:'Не отдавай мне первые двадцать метров.',preLines:['Старт решит всё.'],winLine:'Этого зазора хватило.',loseLine:'Ты снял старт идеально.'},
    {id:'npc_042',name:'Kestrel',power:290,reward:320,unlockLevel:1,car:'Toyota AE86',rating:62,style:'Высокие обороты',favoriteTracks:['Старая эстакада'],wins:33,losses:30,avatar:'KS',taunt:'Держи мотор в зоне, если успеешь.',preLines:['Не упусти обороты.'],winLine:'Ты слишком рано отпустил передачу.',loseLine:'Хороший диапазон.'},
    {id:'npc_043',name:'Echo',power:335,reward:390,unlockLevel:1,car:'Honda Civic',rating:65,style:'Позднее переключение',favoriteTracks:['Тоннель'],wins:42,losses:29,avatar:'EC',taunt:'Я переключаюсь позже большинства.',preLines:['Посмотрим, кто дольше держит передачу.'],winLine:'Отсечка была на моей стороне.',loseLine:'Точно в зелёную.'},
    {id:'npc_044',name:'Jett',power:385,reward:470,unlockLevel:1,car:'Nissan Silvia S15',rating:68,style:'Рывок со старта',favoriteTracks:['Портовый обход'],wins:57,losses:32,avatar:'JT',taunt:'Если увидишь мой бампер — уже поздно.',preLines:['Не моргай на зелёном.'],winLine:'Первый рывок был решающим.',loseLine:'Ты забрал старт.'},
    {id:'npc_045',name:'Riven',power:430,reward:560,unlockLevel:1,car:'Mazda RX-7 FD',rating:71,style:'Контроль тяги',favoriteTracks:['Промзона'],wins:64,losses:35,avatar:'RV',taunt:'Мощность бесполезна без сцепления.',preLines:['Держи колёса за асфальт.'],winLine:'Тяга решила.',loseLine:'Чисто реализовал мощность.'},
    {id:'npc_046',name:'Mako',power:500,reward:700,unlockLevel:1,car:'Mitsubishi Evo IX',rating:74,style:'Полный привод',favoriteTracks:['Портовый обход'],wins:82,losses:38,avatar:'MK',taunt:'На старте я не оставляю места.',preLines:['Первая передача будет короткой.'],winLine:'Полный привод сделал свою работу.',loseLine:'Ты удержал меня.'},
    {id:'npc_047',name:'Pulse',power:565,reward:860,unlockLevel:1,car:'Subaru WRX STI',rating:77,style:'Темповый',favoriteTracks:['Ночной проспект'],wins:96,losses:41,avatar:'PL',taunt:'Я не ускоряюсь рывками. Я держу давление.',preLines:['Сохраняй темп до финиша.'],winLine:'Темп не просел.',loseLine:'Ты был стабильнее.'},
    {id:'npc_048',name:'Cinder',power:630,reward:1050,unlockLevel:1,car:'Ford Mustang GT',rating:80,style:'Тяга с низов',favoriteTracks:['Промзона'],wins:112,losses:47,avatar:'CD',taunt:'Мой момент начинается раньше твоего.',preLines:['Слушай двигатель.'],winLine:'Момента хватило.',loseLine:'Ты растянул передачи лучше.'},
    {id:'npc_049',name:'Onyx',power:705,reward:1350,unlockLevel:1,car:'BMW M4 Competition',rating:83,style:'Точное переключение',favoriteTracks:['Тоннель'],wins:139,losses:45,avatar:'OX',taunt:'Одна ошибка в переключении — и заезд мой.',preLines:['Без лишних движений.'],winLine:'Я дождался ошибки.',loseLine:'Безошибочно. Уважаю.'},
    {id:'npc_050',name:'Atlas',power:780,reward:1750,unlockLevel:1,car:'Mercedes-AMG GT',rating:85,style:'Длинная передача',favoriteTracks:['Старая эстакада'],wins:151,losses:52,avatar:'AT',taunt:'Я заберу вторую половину дистанции.',preLines:['Не празднуй ранний отрыв.'],winLine:'Финиш важнее старта.',loseLine:'Ты не отдал темп.'},
    {id:'npc_051',name:'Crow',power:850,reward:2200,unlockLevel:2,car:'Audi RS6',rating:87,style:'Холодный расчёт',favoriteTracks:['Портовый обход'],wins:176,losses:49,avatar:'CR',taunt:'Я уже знаю, где тебя атаковать.',preLines:['Третья передача покажет всё.'],winLine:'Расчёт сошёлся.',loseLine:'Сегодня я просчитался.'},
    {id:'npc_052',name:'Ion',power:925,reward:2850,unlockLevel:2,car:'Porsche 911 Turbo S',rating:89,style:'Короткие окна',favoriteTracks:['Ночной проспект'],wins:205,losses:44,avatar:'IN',taunt:'Зелёная зона будет короче, чем тебе хочется.',preLines:['Работай точно.'],winLine:'Точность победила.',loseLine:'Ты попал во все окна.'},
    {id:'npc_053',name:'Lock',power:1005,reward:3600,unlockLevel:3,car:'Nissan GT-R R35',rating:91,style:'Контроль старта',favoriteTracks:['Промзона'],wins:236,losses:50,avatar:'LK',taunt:'Я закрываю заезд ещё на старте.',preLines:['Поймай идеальный старт.'],winLine:'Дальше догонять было уже поздно.',loseLine:'Ты выбил меня со старта.'},
    {id:'npc_054',name:'Halo',power:1080,reward:4450,unlockLevel:4,car:'Audi R8 V10',rating:92,style:'Высокие обороты',favoriteTracks:['Тоннель'],wins:258,losses:46,avatar:'HL',taunt:'Мой мотор живёт там, где твой уже сдаётся.',preLines:['Не бойся красной зоны.'],winLine:'Обороты сделали разницу.',loseLine:'Ты выдержал диапазон.'},
    {id:'npc_055',name:'Specter',power:1160,reward:5500,unlockLevel:5,car:'McLaren 720S',rating:94,style:'Поздняя атака',favoriteTracks:['Портовый обход'],wins:292,losses:41,avatar:'SP',taunt:'До середины трассы можешь считать себя первым.',preLines:['Не смотри назад.'],winLine:'Я пришёл тогда, когда нужно.',loseLine:'Ты не оставил мне окна.'},
    {id:'npc_056',name:'Venom',power:1240,reward:6800,unlockLevel:12,car:'Ferrari 488 Pista',rating:95,style:'Агрессивный буст',favoriteTracks:['Ночной проспект'],wins:319,losses:45,avatar:'VN',taunt:'Давление начинается после второй.',preLines:['Удержи линию.'],winLine:'Ты не выдержал темп.',loseLine:'Ты пережил давление.'},
    {id:'npc_057',name:'Rift',power:1320,reward:8200,unlockLevel:13,car:'Ferrari SF90',rating:96,style:'Гибридный рывок',favoriteTracks:['Старая эстакада'],wins:347,losses:39,avatar:'RF',taunt:'Разрыв появится внезапно.',preLines:['Первые метры ничего не значат.'],winLine:'Разрыв открылся вовремя.',loseLine:'Ты его закрыл.'},
    {id:'npc_058',name:'Apex',power:1410,reward:9900,unlockLevel:14,car:'Lamborghini Huracan',rating:97,style:'Идеальная траектория',favoriteTracks:['Промзона'],wins:381,losses:36,avatar:'AX',taunt:'На вершине нет места для двоих.',preLines:['Заезд будет коротким.'],winLine:'Вершина остаётся моей.',loseLine:'Сегодня вершина твоя.',boss:true},
    {id:'npc_059',name:'Nocturne',power:1500,reward:12200,unlockLevel:16,car:'Lamborghini Aventador',rating:98,style:'Ночной темп',favoriteTracks:['Ночной проспект','Тоннель'],wins:425,losses:34,avatar:'NC',taunt:'Ночью ошибки звучат громче.',preLines:['Светофор — последняя спокойная точка.'],winLine:'Ночь оставила тебя позади.',loseLine:'Ты забрал эту ночь.',boss:true},
    {id:'npc_060',name:'Blackstar',power:1600,reward:15000,unlockLevel:18,car:'Bugatti Chiron',rating:99,style:'Максимальная скорость',favoriteTracks:['Портовый обход'],wins:481,losses:30,avatar:'BS',taunt:'После пятой передачи начинается мой заезд.',preLines:['Доживи до максималки.'],winLine:'Скорость всё расставила.',loseLine:'Ты удержал верх.',boss:true},
    {id:'npc_061',name:'Ghostline',power:1700,reward:18500,unlockLevel:20,car:'Carbon Wraith',rating:99,style:'Без следа',favoriteTracks:['Тоннель','Ночной проспект'],wins:536,losses:27,avatar:'GL',taunt:'Увидишь только мои фонари.',preLines:['Не потеряй линию.'],winLine:'След исчез.',loseLine:'Ты остался рядом.',boss:true},
    {id:'npc_062',name:'Sovereign',power:1800,reward:22500,unlockLevel:22,car:'Project Zero',rating:100,style:'Контроль дистанции',favoriteTracks:['Промзона','Портовый обход'],wins:604,losses:24,avatar:'SV',taunt:'Я не выигрываю метрами. Я забираю дистанцию.',preLines:['Считай каждый метр.'],winLine:'Дистанция принадлежит мне.',loseLine:'Ты отнял её.',boss:true},
    {id:'npc_063',name:'Oblivion',power:1925,reward:27500,unlockLevel:24,car:'Syndicate Prototype',rating:100,style:'Без компромиссов',favoriteTracks:['Ночной проспект','Старая эстакада'],wins:681,losses:19,avatar:'OB',taunt:'После старта останется только секундомер.',preLines:['Никаких оправданий.'],winLine:'Секундомер сказал всё.',loseLine:'Запомню это время.',boss:true},
    {id:'npc_064',name:'Carbon Prime',power:2075,reward:34000,unlockLevel:26,car:'Carbon One-Off',rating:100,style:'Эталонный',favoriteTracks:['Ночной проспект','Тоннель','Портовый обход'],wins:812,losses:14,avatar:'CP',taunt:'Добрался сюда — значит, заслужил один шанс.',preLines:['Один старт. Одна попытка.'],winLine:'Carbon District всё ещё мой.',loseLine:'Теперь район знает твоё имя.',boss:true}
  ];
  EXTRA_RIVALS.forEach(r=>{if(!opponentsDB.some(o=>String(o.id)===String(r.id)))opponentsDB.push(r);});
  const baseProfiles=[
    {avatar:'ST',style:'Нервный старт',favoriteTracks:['Промзона'],wins:18,losses:32,car:'ВАЗ 2101',rating:58,preLines:['Только не заглохни.'],winLine:'Ну что, музыка всё-таки помогла.',loseLine:'Ладно, мотор у тебя бодрый.'},
    {avatar:'TL',style:'Ранний SHIFT',favoriteTracks:['Тоннель'],wins:29,losses:25,car:'Volkswagen Golf',rating:63,preLines:['Чип сегодня злой.'],winLine:'Я же говорил про чип.',loseLine:'Надо было прошивку другую ставить.'},
    {avatar:'AV',style:'Рывками',favoriteTracks:['Ночной проспект'],wins:44,losses:30,car:'Audi S4',rating:69,preLines:['Только быстро, пока никто не звонит.'],winLine:'Вот это будет сложно объяснить дома.',loseLine:'Никому не рассказывай.'},
    {avatar:'FX',style:'Агрессивный',favoriteTracks:['Портовый обход'],wins:83,losses:28,car:'Nissan 350Z',rating:79,preLines:['Дуэль начинается после зелёного.'],winLine:'Это и есть разница между гонкой и прогулкой.',loseLine:'Сегодня это была гонка.'},
    {avatar:'VD',style:'Стабильный',favoriteTracks:['Старая эстакада'],wins:135,losses:51,car:'BMW M4',rating:85,preLines:['Не отставай после третьей.'],winLine:'Стабильность скучная, пока не выигрывает.',loseLine:'Ты был стабильнее.'},
    {avatar:'TN',style:'Тихий',favoriteTracks:['Тоннель'],wins:188,losses:46,car:'Toyota Supra MK4',rating:90,preLines:['...'],winLine:'...',loseLine:'Хорошо.'},
    {avatar:'DR',style:'Босс',favoriteTracks:['Ночной проспект'],wins:302,losses:44,car:'Lamborghini Huracan',rating:96,preLines:['Не разочаруй меня.'],winLine:'Ещё рано называться легендой.',loseLine:'Теперь можешь.',boss:true},
    {avatar:'PN',style:'Финишер',favoriteTracks:['Портовый обход'],wins:409,losses:37,car:'Ferrari SF90',rating:98,preLines:['Финиш решает всё.'],winLine:'Первым считают только одного.',loseLine:'Сегодня им был ты.',boss:true},
    {avatar:'SY',style:'Абсолютное давление',favoriteTracks:['Промзона'],wins:701,losses:22,car:'Bugatti Chiron',rating:100,preLines:['Покажи, зачем ты сюда пришёл.'],winLine:'Синдикат не отдаёт корону просто так.',loseLine:'Корона твоя. Пока.',boss:true}
  ];
  opponentsDB.forEach((o,i)=>Object.assign(o,baseProfiles[i]||{},o));
  function rivalMeta(opp){
    const rec=state.rivalRecords?.[String(opp.id)]||{wins:0,losses:0};return {avatar:opp.avatar||String(opp.name).slice(0,2).toUpperCase(),style:opp.style||'Сбалансированный',favoriteTracks:opp.favoriteTracks||['Промзона'],wins:opp.wins||0,losses:opp.losses||0,car:opp.car||'Уличная сборка',rating:opp.rating||Math.min(99,Math.round(50+(opp.power||200)/18)),record:rec};
  }
  renderOpponents=function(){
    updateHeader();const c=document.getElementById('opponent-list');if(!c)return;c.innerHTML='';const car=carsDB.find(x=>x.id===state.activeCarId);if(!car){c.innerHTML='<div class="empty-note">Сначала выберите активную машину.</div>';return;}
    if(state.licenseSuspended){c.innerHTML='<div class="empty-note">Права изъяты. Восстановите допуск к заездам в профиле.</div>';return;}
    const list=state.duelSub==='tour'?tournamentsDB:opponentsDB,myPower=getEffectivePower(car),history=state.raceHistory||[];let pool=list.filter(o=>state.level>=o.unlockLevel);
    if(state.duelSub==='tour'){
      const now=Date.now(),day=new Date().toISOString().slice(0,10);pool=pool.filter(o=>{const r=state.tournamentRuns[String(o.id)]||{};const count=r.day===day?(Number(r.count)||0):0,next=r.day===day?(Number(r.next)||0):0;return count<3&&next<=now;});
    } else {const fresh=pool.filter(o=>!history.slice(-4).includes(String(o.id)));if(fresh.length>=5)pool=fresh;}
    pool=pool.slice().sort(()=>secureRandom()-.5).slice(0,Math.min(state.duelSub==='tour'?3:7,pool.length));
    if(!pool.length){c.innerHTML='<div class="empty-note">Доступных соперников сейчас нет.</div>';return;}
    c.innerHTML='<div class="race-event-badge"><span>СЕТКА СОПЕРНИКОВ</span><b>'+pool.length+' ДОСТУПНО</b></div>'+pool.map((opp,idx)=>{
      const m=rivalMeta(opp),winChance=Math.max(5,Math.min(95,Math.round(50+(myPower-opp.power)/Math.max(opp.power,1)*86))),fee=entryFeeFor(opp),recent=history.includes(String(opp.id));
      const r=state.tournamentRuns[String(opp.id)]||{},day=new Date().toISOString().slice(0,10),count=state.duelSub==='tour'&&r.day===day?(Number(r.count)||0):0,mult=state.duelSub==='tour'?([1,.72,.48][Math.min(2,count)]||.48):1,reward=Math.round(opp.reward*mult);
      return '<div class="rival-card '+(opp.boss?'boss':'')+'" style="animation-delay:'+idx*45+'ms"><div class="rival-top"><div class="rival-avatar">'+escapeHtml(m.avatar)+'</div><div class="rival-id"><b>'+escapeHtml(opp.name)+'</b><span>'+escapeHtml(m.car)+' · РЕЙТИНГ '+m.rating+'</span></div><div class="rival-power">'+opp.power+'<small>л.с.</small></div></div><div class="rival-quote">“'+escapeHtml(opp.taunt||pick(opp.preLines||['Встретимся на финише.']))+'”</div><div class="rival-profile-grid"><span>Стиль<b>'+escapeHtml(m.style)+'</b></span><span>Любит<b>'+escapeHtml(m.favoriteTracks[0])+'</b></span><span>История<b>'+m.wins+'–'+m.losses+'</b></span><span>С вами<b>'+m.record.wins+'–'+m.record.losses+'</b></span></div><div class="odds-bar-bg"><div class="odds-win" style="width:'+winChance+'%"></div><div class="odds-lose" style="width:'+(100-winChance)+'%"></div></div><div class="opp-foot"><span>Шанс <b>'+winChance+'%</b></span><span>Вход <b>'+fmt(fee)+'</b></span><span>Приз <b>'+fmt(reward)+'</b></span></div><button class="btn btn-select" onclick="prepareRace(\''+String(opp.id).replace(/'/g,"\\'")+'\',\''+(state.duelSub==='tour'?'tour':'normal')+'\')">НА ЛИНИЮ</button>'+(recent?'<small class="recent-rival">Недавняя встреча</small>':'')+'</div>';
    }).join('');
  };

  /* ---------- RACE DYNAMICS ---------- */
  raceTuneProfile=function(car){
    const u=getUpg(car.id),engine=Number(u.engine||0),trans=Number(u.gearbox||0),turbo=Number(u.turbo||0),grip=Number(u.tires||0),sum=engine+trans+turbo+grip;
    return {sum,engine,trans,turbo,grip,rpmRate:1.18+engine*.09+turbo*.10+trans*.045+sum*.018,greenWidth:.022+trans*.006,yellowWidth:.050+trans*.009,launchGrip:Math.min(.995,.72+grip*.045+trans*.018),accel:1.05+engine*.065+turbo*.085+trans*.024,shiftRecovery:Math.min(.78,.54+trans*.042),errorRecovery:Math.min(.82,.62+trans*.032)};
  };
  const basePrepareRace=prepareRace;
  prepareRace=function(target,mode){
    basePrepareRace(target,mode);if(!raceCtx)return;const car=carsDB.find(x=>x.id===state.activeCarId),raw=getEffectivePower(car),stock=car.power,u=getUpg(car.id),upgradeRatio=Math.max(0,(raw-stock)/Math.max(stock,1));
    raceCtx.maxSpeed=Math.round(Math.max(205,Math.min(445,205+raw*.145+upgradeRatio*42)));
    raceCtx.aiMaxSpeed=Math.round(Math.max(200,Math.min(438,202+(Number(raceCtx.opp.power)||raw)*.142)));
    raceCtx.trackLength=1450+Math.floor(secureRandom()*260);raceCtx.shiftBoost=1;raceCtx.shiftBoostTimer=0;raceCtx.pressure=0;raceCtx.eventCooldown=2.5;raceCtx.draftTimer=0;raceCtx.aiSurgeTimer=0;raceCtx.nearMisses=0;raceCtx.overtakes=0;raceCtx.rival=rivalMeta(raceCtx.opp);raceCtx.gearboxLevel=Number(u.gearbox)||0;
    renderRaceBrief();
  };
  renderRaceBrief=function(){
    const c=raceCtx,car=carsDB.find(x=>x.id===state.activeCarId),o=c.opp,m=c.rival||rivalMeta(o),line=pick(o.preLines||[o.taunt||'Встретимся на финише.']);
    document.getElementById('race-content').innerHTML='<div class="race3"><div class="race-event-badge"><span>'+escapeHtml(c.route)+'</span><b>'+c.trackLength+' М · STREET DUEL</b></div><div class="race3-top"><div class="race3-driver"><b>ВЫ</b><span>'+escapeHtml(car.name)+' · '+getEffectivePower(car)+' л.с.</span></div><div class="race3-vs">VS</div><div class="race3-driver" style="text-align:right"><b>'+escapeHtml(o.name)+'</b><span>'+escapeHtml(m.car)+' · '+o.power+' л.с.</span></div></div><div class="rival-intro"><div class="rival-avatar large">'+escapeHtml(m.avatar)+'</div><div><span>'+escapeHtml(m.style)+' · РЕЙТИНГ '+m.rating+'</span><b>“'+escapeHtml(line)+'”</b><small>Любимые трассы: '+escapeHtml(m.favoriteTracks.join(' · '))+' · Карьера '+m.wins+'–'+m.losses+'</small></div></div><div class="pre-race-box"><div class="pre-race-line"><span>Вход</span><b>'+fmt(c.fee)+' SYND</b></div><div class="pre-race-line"><span>Топливо</span><b>'+c.fuelCost+'%</b></div><div class="pre-race-line"><span>Победа</span><b>'+fmt(o.reward)+' SYND</b></div><div class="pre-race-line"><span>КПП</span><b>УР. '+c.gearboxLevel+'/5</b></div></div><button class="big-btn" onclick="beginLaunch()">ВЫЕХАТЬ НА ЛИНИЮ</button><button class="btn btn-ghost" style="margin-top:8px" onclick="switchTab(\'duel-select\')">ОТМЕНА</button></div>';
  };
  beginLaunch=function(){
    const car=carsDB.find(x=>x.id===state.activeCarId),c=raceCtx;if(!c)return;state.coins-=c.fee;state.stats.totalSpent+=c.fee;state.fuel[car.id]=Math.max(0,getFuel(car.id)-c.fuelCost);updateHeader();saveState();
    document.getElementById('race-content').innerHTML='<div class="race3"><div class="race-event-badge"><span>КОНТРОЛЬ СТАРТА</span><b>ПОЙМАЙ ЗОНУ</b></div><div class="launch-panel"><div class="launch-title">ЧУВСТВИТЕЛЬНЫЙ СТАРТ</div><div class="launch-copy">Зелёная зона даёт максимальное сцепление и стартовый импульс. Жёлтая сохраняет хороший темп.</div><div class="launch-meter"><div class="launch-zone yellow"></div><div class="launch-zone green"></div><div class="launch-marker" id="launch-marker"></div></div><div class="launch-rpm" id="launch-rpm">1 100 RPM</div><div class="launch-buttons"><button class="launch-btn safe" onclick="chooseLaunch(\'safe\')">КОНТРОЛЬ<small>стабильный зацеп</small></button><button class="launch-btn hard" onclick="chooseLaunch(\'spin\')">АТАКА<small>максимальный импульс</small></button></div></div></div>';
    c.launchPos=10;c.launchDir=1;c.launchLast=performance.now();
    const tick=(now)=>{if(!raceCtx||raceCtx!==c||c.finished||c.launchMode)return;const dt=Math.min(.04,(now-c.launchLast)/1000);c.launchLast=now;c.launchPos+=c.launchDir*(49+c.profile.rpmRate*9)*dt;if(c.launchPos>=92){c.launchPos=92;c.launchDir=-1;}if(c.launchPos<=6){c.launchPos=6;c.launchDir=1;}const m=document.getElementById('launch-marker'),r=document.getElementById('launch-rpm');if(m)m.style.left=c.launchPos+'%';if(r)r.textContent=Math.round(900+c.launchPos/100*7800).toLocaleString('ru-RU')+' ОБ/МИН';c.launchRaf=requestAnimationFrame(tick);};
    c.launchRaf=requestAnimationFrame(tick);
  };
  const baseChooseLaunch=chooseLaunch;
  chooseLaunch=function(mode){const c=raceCtx;if(c?.launchRaf)cancelAnimationFrame(c.launchRaf);baseChooseLaunch(mode);if(!c)return;const q=Math.max(0,1-Math.abs((c.launchPos/100)-.67)/.30);c.launchQuality=q;c.speed*=1.10+q*.35;c.distance+=q*2.2;c.rpm=Math.min(c.redline*.82,c.rpm*(1.05+q*.12));if(q>.9){c.shiftBoost=1.12;c.shiftBoostTimer=.75;showAction('ИДЕАЛЬНЫЙ СТАРТ · ТЯГА +12%');}else if(q>.72){c.shiftBoost=1.06;c.shiftBoostTimer=.45;showAction('ХОРОШИЙ СТАРТ · ТЯГА +6%');}};
  manualShift=function(){
    const c=raceCtx;if(!c||c.finished||c.startLocked)return;if(c.gear>=6){showShiftText('6-Я ПЕРЕДАЧА · ДЕРЖИ ТЯГУ',false);return;}
    const p=c.rpm/c.redline,g=c.profile.greenWidth,y=c.profile.yellowWidth,center=.78,perfect=Math.abs(p-center)<=g,good=Math.abs(p-center)<=y;c.shiftCount++;c.gear=Math.min(6,c.gear+1);
    if(perfect){c.perfectShifts++;c.goodShifts++;c.shiftBoost=1.18+Math.min(.05,c.profile.trans*.01);c.shiftBoostTimer=.62;c.rpm=Math.max(3400,c.rpm*c.profile.shiftRecovery);c.speed+=Math.max(3,c.speed*.018);recordContractEvent('perfectShift',1);haptic('success');showAction('ИДЕАЛЬНОЕ ПЕРЕКЛЮЧЕНИЕ · BOOST ТЯГИ');showShiftText('ИДЕАЛЬНОЕ ПЕРЕКЛЮЧЕНИЕ · МИНИМУМ ПОТЕРИ ОБОРОТОВ',true);}
    else if(good){c.goodShifts++;c.shiftBoost=1.08;c.shiftBoostTimer=.38;c.rpm=Math.max(3000,c.rpm*c.profile.shiftRecovery*.95);c.speed+=2;haptic('medium');showAction('ХОРОШЕЕ ПЕРЕКЛЮЧЕНИЕ · УСКОРЕНИЕ');showShiftText('ХОРОШЕЕ ПЕРЕКЛЮЧЕНИЕ · ТЯГА +8%',false);}
    else{c.errors++;const late=p>.96,rec=c.profile.errorRecovery;c.shiftBoost=Math.max(.86,.78+c.profile.trans*.018);c.shiftBoostTimer=.48;c.rpm=Math.max(late?2800:2200,c.rpm*(late?rec*.78:rec*.88));c.speed*=Math.max(.91,.86+c.profile.trans*.012);haptic('warning');showAction((late?'ПОЗДНИЙ':'РАННИЙ')+' SHIFT · ПОТЕРЯ ТЯГИ');showShiftText((late?'ПОЗДНО':'РАНО')+' · КПП СТАБИЛИЗИРУЕТ ТЯГУ',false);}
    updateRaceHUD();
  };
  simulateRace=function(dt){
    const c=raceCtx;if(c.startLocked)return;c.elapsed+=dt;if(c.nitroTimer>0){c.nitroTimer=Math.max(0,c.nitroTimer-dt);c.nitroActive=c.nitroTimer>0;}if(c.shiftBoostTimer>0){c.shiftBoostTimer=Math.max(0,c.shiftBoostTimer-dt);}else c.shiftBoost+=(1-c.shiftBoost)*Math.min(1,dt*5);if(c.actionTimer>0){c.actionTimer-=dt;if(c.actionTimer<=0)document.getElementById('race-action')?.classList.remove('show');}
    const p=c.profile,gear=c.gear,ratios=[0,.63,.76,.86,.93,.98,1],ratio=ratios[gear],rpmNorm=c.rpm/c.redline;
    if(c.gas&&!c.brake){const gain=1680*p.rpmRate*(.72+ratio*.38)*dt;if(gear<6)c.rpm=Math.min(c.redline*1.012,c.rpm+gain);else c.rpm=Math.min(c.redline*.995,c.rpm+gain*.24);const band=Math.max(.18,Math.min(1,rpmNorm)),launch=(c.launchMode==='spin'&&c.distance<16)?c.launchGrip:.995,nitro=c.nitroActive?1.36:1,boost=c.shiftBoost||1;const base=(c.maxSpeed*1.02)*p.accel*ratio*(.54+band*.88)*launch*nitro*boost;const resistance=.017*c.speed*c.speed/Math.max(c.maxSpeed,1);c.speed+=Math.max(0,base-resistance)*dt;}else{c.rpm=Math.max(1100,c.rpm-1200*dt);c.speed=Math.max(0,c.speed-7*dt);}if(c.brake){c.rpm=Math.max(1100,c.rpm-3400*dt);c.speed=Math.max(0,c.speed-82*dt);}const cap=c.nitroActive?Math.min(470,c.maxSpeed*1.065):c.maxSpeed;c.speed=Math.max(0,Math.min(cap,c.speed));c.topSpeed=Math.max(c.topSpeed||0,c.speed);c.distance=Math.min(c.trackLength,c.distance+(c.speed/3.6)*dt);
    const myPower=getEffectivePower(carsDB.find(x=>x.id===state.activeCarId)),ratioPower=Math.max(.70,Math.min(1.32,c.opp.power/Math.max(myPower,1))),gap=c.distance-c.aiDistance,style=c.rival?.style||'';let aggression=.99+(ratioPower-1)*.17;if(/Агрессив|давлен|Контрат|Босс/i.test(style))aggression+=.035;if(gap>8)aggression+=Math.min(.055,gap/300);if(gap<-18)aggression-=.018;if(c.aiSurgeTimer>0){c.aiSurgeTimer-=dt;aggression+=.055;}const variation=1+Math.sin(c.elapsed*.77)*.022+Math.sin(c.elapsed*1.83)*.011,target=Math.min(c.aiMaxSpeed*.997,c.aiMaxSpeed*aggression*c.aiSkill*variation);c.aiSpeed+=((target-c.aiSpeed)*1.55*dt);if(c.elapsed<c.aiStartDelay)c.aiSpeed*=Math.max(0,1-dt*6);c.aiSpeed=Math.max(0,Math.min(c.aiMaxSpeed*1.01,c.aiSpeed));c.aiDistance=Math.min(c.trackLength,c.aiDistance+(c.aiSpeed/3.6)*dt);
    c.eventCooldown-=dt;if(c.eventCooldown<=0&&c.elapsed>3){c.eventCooldown=3.2+secureRandom()*4.2;const liveGap=c.distance-c.aiDistance;if(Math.abs(liveGap)<12&&secureRandom()<.68){c.pressure=Math.min(1,c.pressure+.35);c.aiSurgeTimer=.8+secureRandom()*.8;showAction(liveGap>=0?'СОПЕРНИК ДАВИТ СЗАДИ · НЕ ОШИБИСЬ':'ВИСИШЬ НА БАМПЕРЕ · МОМЕНТ ДЛЯ ОБГОНА');}else if(c.speed>c.maxSpeed*.72&&secureRandom()<.4){c.nearMisses++;showAction('ТРАФИК ВПЕРЕДИ · ДЕРЖИ ТЕМП');}}
    if(c.aiDistance>=c.trackLength&&!c.aiFinishedAt){c.aiFinishedAt=c.elapsed;showAction('СОПЕРНИК ФИНИШИРОВАЛ · ДОЖИМАЙ');}if(c.distance>=c.trackLength){c.playerFinishedAt=c.elapsed;finishRace(!c.aiFinishedAt||c.playerFinishedAt<=c.aiFinishedAt,c);}
  };
  updateRaceZones=function(){
    const c=raceCtx;if(!c)return;const centerNorm=.78,center=centerNorm*264-132;
    const greenDeg=Math.max(8,Math.min(30,c.profile.greenWidth*528));
    const yellowDeg=Math.max(greenDeg+9,Math.min(58,c.profile.yellowWidth*528));
    const d=document.getElementById('rpm-dial');if(d){d.style.setProperty('--yellow-start',(center-yellowDeg/2)+'deg');d.style.setProperty('--yellow-end',(center+yellowDeg/2)+'deg');d.style.setProperty('--green-start',(center-greenDeg/2)+'deg');d.style.setProperty('--green-end',(center+greenDeg/2)+'deg');}
    const sd=document.getElementById('speed-dial');if(sd){sd.style.setProperty('--yellow-start','999deg');sd.style.setProperty('--yellow-end','1000deg');sd.style.setProperty('--green-start','1001deg');sd.style.setProperty('--green-end','1002deg');}
  };
  const baseUpdateRaceHUD=updateRaceHUD;
  updateRaceHUD=function(){baseUpdateRaceHUD();const c=raceCtx;if(!c)return;const fx=document.getElementById('speed-effects');if(fx){const intensity=Math.max(0,Math.min(1,(c.speed-c.maxSpeed*.35)/(c.maxSpeed*.55)));fx.style.setProperty('--speed-intensity',intensity.toFixed(2));fx.classList.toggle('warp',intensity>.62||c.nitroActive);}const root=document.querySelector('.race3');if(root){root.style.setProperty('--race-speed',Math.max(0,Math.min(1,c.speed/c.maxSpeed)).toFixed(2));root.classList.toggle('under-pressure',Math.abs(c.distance-c.aiDistance)<10&&c.elapsed>2);}};
  const baseFinishRace=finishRace;
  finishRace=function(won,c){
    const o=c?.opp,m=c?.rival||rivalMeta(o||{});baseFinishRace(won,c);if(!c||!o)return;state.rivalRecords=state.rivalRecords||{};const rec=state.rivalRecords[String(o.id)]||{wins:0,losses:0};if(won)rec.wins++;else rec.losses++;rec.lastResult=won?'win':'loss';state.rivalRecords[String(o.id)]=rec;saveState();const line=won?(o.loseLine||'Чистый заезд. Увидимся ещё.'):(o.winLine||'В следующий раз не оставляй мне место.');const race=document.querySelector('#race-content .race3');if(race){const d=document.createElement('div');d.className='rival-reaction';d.innerHTML='<div class="rival-avatar">'+escapeHtml(m.avatar)+'</div><div><span>'+escapeHtml(o.name)+'</span><b>“'+escapeHtml(line)+'”</b></div>';race.appendChild(d);}if(typeof syncPlayerProfile==='function')setTimeout(async()=>{await syncPlayerProfile(true);claimFirstRaceReferralBonus();},120);};

  /* ---------- CASES ---------- */
  const CASES_V8=[
    {id:'bronze',name:'Street Case',price:350,desc:'Базовый кейс. Деньги, детали и номера.',guarantee:'RARE каждые 10',weights:[['common',72],['rare',23],['epic',4.7],['legendary',.3]]},
    {id:'silver',name:'Carbon Case',price:1400,desc:'Больше тюнинга, редких номеров и высокий возврат.',guarantee:'RARE каждые 6 · EPIC каждые 20',weights:[['common',50],['rare',37],['epic',11.8],['legendary',1.2]]},
    {id:'gold',name:'Syndicate Case',price:4500,desc:'Лучший пул. Маленький шанс редкой машины.',guarantee:'EPIC каждые 12 · машина максимум за 50',weights:[['common',35],['rare',42],['epic',20],['legendary',2.7],['mythic',.3]]}
  ];
  function chooseCaseRarity(cs){
    const p=state.casePity; p[cs.id]=(p[cs.id]||0)+1;if(cs.id==='gold')p.goldCar=(p.goldCar||0)+1;
    let r=rollRarity(cs.weights);if(cs.id==='bronze'&&p.bronze>=10&&RARITY_ORDER[r]<1){r='rare';p.bronze=0;}if(cs.id==='silver'){if(p.silver%20===0&&RARITY_ORDER[r]<2)r='epic';else if(p.silver%6===0&&RARITY_ORDER[r]<1)r='rare';}if(cs.id==='gold'&&p.gold%12===0&&RARITY_ORDER[r]<2)r='epic';return r;
  }
  function makeCasePrize(cs,forcedRarity){
    const rarity=forcedRarity||chooseCaseRarity(cs);let typeRoll=secureRandom();
    if(cs.id==='gold'&&state.casePity.goldCar>=50){typeRoll=.99999;state.casePity.goldCar=0;}
    if(cs.id==='gold'&&((rarity==='legendary'&&typeRoll>.88)||(rarity==='mythic'&&typeRoll>.70)||typeRoll>.9965)){
      const reserved=escrowCarIds();const possible=carsDB.filter(c=>c.id>=18&&!state.ownedCars.includes(c.id)&&!reserved.has(c.id));if(possible.length){const car=pick(possible);return {type:'car',rarity:rarity==='mythic'?'mythic':'legendary',label:car.name,carId:car.id};}
    }
    if(typeRoll<.46){const mult={common:[.45,1.05],rare:[.9,1.7],epic:[1.5,2.8],legendary:[2.5,4.5],mythic:[4,7]}[rarity],amount=Math.round(cs.price*(mult[0]+secureRandom()*(mult[1]-mult[0])));return {type:'coins',rarity,label:fmt(amount)+' SYND',amount};}
    if(typeRoll<.75){const choices=TUNE_TYPES.filter(t=>(getUpg(state.activeCarId)[t.key]||0)<5);if(choices.length){const part=pick(choices);return {type:'tuning',rarity,label:PART_LABEL[part.key]+' · +1 УР.',part:part.key};}}
    const plate=makePlate(rarity);return {type:'plate',rarity,label:plate.text,plate};
  }
  function grantCasePrize(prize,cs){
    if(prize.type==='coins'){state.coins+=prize.amount;state.stats.totalEarned+=prize.amount;}
    else if(prize.type==='tuning'){const carId=state.activeCarId,u=getUpg(carId),before=u[prize.part]||0;if(before<5){u[prize.part]=before+1;state.tuningHistory[carId]=state.tuningHistory[carId]||[];state.tuningHistory[carId].push({ts:Date.now(),part:prize.part,level:before+1,price:0,source:'case'});}}
    else if(prize.type==='plate'){state.plateInventory.push(prize.plate);}
    else if(prize.type==='car'){if(!state.ownedCars.includes(prize.carId)){state.ownedCars.push(prize.carId);getUpg(prize.carId);getFuel(prize.carId);getCondition(prize.carId);state.casePity.goldCar=0;}}
    state.caseHistory.push({ts:Date.now(),caseId:cs.id,label:prize.label,rarity:prize.rarity,type:prize.type});state.caseHistory=state.caseHistory.slice(-60);updateHeader();saveState();checkAchievements();
  }
  function caseItemHtml(p){return '<div class="case-reel-item rar-'+p.rarity+'"><span>'+RARITY_LABEL[p.rarity]+'</span><b>'+escapeHtml(p.label)+'</b><small>'+({coins:'SYND',tuning:'TUNING',plate:'PLATE',car:'VEHICLE'}[p.type]||'DROP')+'</small></div>';}
  renderCases=function(){
    const root=document.getElementById('cases-list');if(!root)return;const hist=(state.caseHistory||[]).slice().reverse();root.innerHTML=CASES_V8.map(cs=>'<div class="case-v8-card"><div class="case-v8-mark">'+svgIcon('case')+'</div><div class="case-v8-body"><div class="case-v8-title"><b>'+cs.name+'</b><span>'+fmt(cs.price)+' SYND</span></div><p>'+cs.desc+'</p><div class="case-chances">'+cs.weights.map(([r,w])=>'<span class="rar-'+r+'">'+RARITY_LABEL[r]+' '+w+'%</span>').join('')+'</div><small>Гарантия: '+cs.guarantee+(cs.id==='gold'?' · автомобиль ~0.7% до pity':'')+'</small><button class="btn btn-gold" '+(state.coins<cs.price||state.caseOpening?'disabled':'')+' onclick="openCase(\''+cs.id+'\')">ОТКРЫТЬ</button></div></div>').join('')+'<div class="case-history"><div class="v8-section-head"><b>ИСТОРИЯ ОТКРЫТИЙ</b><span>'+hist.length+'</span></div>'+(hist.length?hist.slice(0,12).map(x=>'<div class="history-row"><span class="rar-'+x.rarity+'">'+RARITY_LABEL[x.rarity]+'</span><b>'+escapeHtml(x.label)+'</b><small>'+new Date(x.ts).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</small></div>').join(''):'<div class="empty-note">Кейсы ещё не открывались.</div>')+'</div>';
  };
  openCase=function(caseId){
    const cs=CASES_V8.find(x=>x.id===caseId);if(!cs||state.caseOpening)return;if(state.coins<cs.price){showToast('Недостаточно SYND');return;}
    state.caseOpening=true;state.coins-=cs.price;state.stats.totalSpent+=cs.price;state.stats.casesOpened++;
    const final=makeCasePrize(cs),strip=[];for(let i=0;i<42;i++)strip.push(i===35?final:makeCasePrize(cs,rollRarity(cs.weights)));
    // Commit payment + reward before the cosmetic animation. A reload/crash can no longer charge the case without preserving its drop.
    grantCasePrize(final,cs);
    ensureCaseModal();const modal=document.getElementById('case-open-modal');modal.classList.add('show');modal.innerHTML='<div class="case-open-shell"><div class="case-open-head"><span>'+cs.name+'</span><b>DROP ROLL</b></div><div class="case-reel-window"><div class="case-center-line"></div><div class="case-reel-track" id="case-reel-track">'+strip.map(caseItemHtml).join('')+'</div></div><div class="case-open-status" id="case-open-status">Прокрутка...</div></div>';
    requestAnimationFrame(()=>requestAnimationFrame(()=>{const track=document.getElementById('case-reel-track');if(track)track.style.transform='translateX(calc(50% - '+(35*146+73)+'px))';}));
    setTimeout(()=>{const st=document.getElementById('case-open-status');if(st)st.innerHTML='<span class="rar-'+final.rarity+'">'+RARITY_LABEL[final.rarity]+'</span><b>'+escapeHtml(final.label)+'</b><button class="btn btn-select" onclick="closeCaseModal()">ЗАБРАТЬ</button>';state.caseOpening=false;saveState();renderCases();},3050);
  };
  function ensureCaseModal(){if(document.getElementById('case-open-modal'))return;const d=document.createElement('div');d.id='case-open-modal';d.className='case-open-modal';document.body.appendChild(d);}
  window.closeCaseModal=function(){document.getElementById('case-open-modal')?.classList.remove('show');};

  /* ---------- MARKET: FULL VEHICLE ---------- */
  function marketVehicleFromRow(r){
    let v=r.vehicle_data;if(typeof v==='string'){try{v=JSON.parse(v);}catch(_){v=null;}}
    const carId=parseInt((v&&v.carId)||r.car_id,10),car=carsDB.find(c=>c.id===carId),raw=plainObject(v)?v:{};
    const upgrades={engine:0,turbo:0,gearbox:0,tires:0,...(plainObject(raw.upgrades)?raw.upgrades:{})};
    TUNE_TYPES.forEach(t=>upgrades[t.key]=intNumber(upgrades[t.key],0,0,5));
    const condition=finiteNumber(raw.condition,100,0,100),fuel=finiteNumber(raw.fuel,100,0,100);
    let mult=1,tuningValue=0,totalStages=0;
    if(car)TUNE_TYPES.forEach(t=>{const lvl=upgrades[t.key];totalStages+=lvl;for(let i=0;i<lvl;i++){mult+=t.hpPerStage[i];tuningValue+=tuneStagePrice(car,i);}});
    if(condition<40)mult*=.85;else if(condition<70)mult*=.93;
    return {version:2,carId,upgrades,fuel,condition,plate:normalizePlate(raw.plate),tuningHistory:Array.isArray(raw.tuningHistory)?raw.tuningHistory.slice(-30):[],effectivePower:car?Math.round(car.power*mult):0,tuningValue,buildRating:Math.round(totalStages/20*100)};
  }
  renderMarketList=function(rows){
    const c=document.getElementById('market-list');if(!c)return;c.innerHTML='';if(!rows.length){c.innerHTML='<div class="empty-note">Активных лотов нет.</div>';return;}rows.forEach(r=>{const v=marketVehicleFromRow(r),car=carsDB.find(x=>x.id===Number(v.carId||r.car_id));if(!car)return;const u=v.upgrades||{},mine=r.seller_id===state.playerId,plate=v.plate;c.innerHTML+='<div class="listing-card market-v8"><div class="listing-head"><span class="listing-name">'+escapeHtml(car.name)+'</span>'+(mine?'<span class="mine-tag">ВАШ ЛОТ</span>':'')+'</div><div class="listing-meta">'+escapeHtml(r.seller_name||'Игрок')+' · '+(v.effectivePower||car.power)+' л.с. · Build '+(v.buildRating||0)+'/100</div><div class="market-tune-grid"><span>Двигатель<b>'+Number(u.engine||0)+'/5</b></span><span>Турбо<b>'+Number(u.turbo||0)+'/5</b></span><span>КПП<b>'+Number(u.gearbox||0)+'/5</b></span><span>Шины<b>'+Number(u.tires||0)+'/5</b></span></div><div class="market-installed"><span>Тюнинг <b>'+fmt(v.tuningValue||0)+' SYND</b></span><span>Номер <b>'+(plate?escapeHtml(plate.text)+' · '+RARITY_LABEL[plate.rarity]:'нет')+'</b></span></div><div class="listing-head"><span class="listing-price">'+fmt(r.price)+' SYND</span>'+(mine?'<button class="sell-btn" onclick="cancelListing('+r.id+')">Снять</button>':'<button class="btn btn-buy" onclick="buyListing('+r.id+')">КУПИТЬ</button>')+'</div></div>';});
  };
  stateSellPrice=function(car){return Math.max(50,Math.round((car.price+tuningInstalledValue(car.id)*.52+(activePlate(car.id)?.value||0)*.35)*(0.52+getCondition(car.id)/100*.18)));};
  async function marketApiV10(body){
    const response=await serverFetch('/api/market',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),payload=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(payload?.error||('market request rejected '+response.status));
    return payload?.data;
  }
  promptListCar=function(carId){const car=carsDB.find(c=>c.id===carId),snap=vehicleSnapshot(carId),suggested=Math.round((car.price+(snap?.tuningValue||0)*.72+(snap?.plate?.value||0)*.45)*.82)||100;const input=window.prompt('Цена за '+car.name+' вместе с тюнингом и установленным номером. Ориентир: '+fmt(suggested),suggested);if(input===null)return;const price=parseInt(input,10);if(!price||price<=0||price>MAX_MARKET_PRICE){showToast('Цена должна быть от 1 до '+fmt(MAX_MARKET_PRICE)+' SYND');return;}listCarForSale(carId,price);};
  listCarForSale=async function(carId,price){
    if(!await requireOnlineWrite('Рынок'))return;if(!state.ownedCars.includes(carId)||state.ownedCars.length<=1)return;price=Math.trunc(Number(price));if(!Number.isFinite(price)||price<1||price>MAX_MARKET_PRICE)return;const car=carsDB.find(c=>c.id===carId),snapshot=vehicleSnapshot(carId);
    try{const data=await marketApiV10({action:'list',price,vehicle:snapshot});if(!data?.id)throw new Error('listing id missing');state.marketEscrow[String(data.id)]=snapshot;state.ownedCars=state.ownedCars.filter(id=>id!==carId);if(snapshot?.plate){state.plateInventory=state.plateInventory.filter(p=>p.uid!==snapshot.plate.uid);Object.keys(state.installedPlates||{}).forEach(k=>{if(state.installedPlates[k]===snapshot.plate.uid)delete state.installedPlates[k];});}delete state.upgrades[carId];delete state.fuel[carId];delete state.condition[carId];delete state.tuningHistory[carId];if(state.activeCarId===carId)state.activeCarId=state.ownedCars[0];showToast(car.name+' выставлена вместе с тюнингом');updateHeader();saveState();refreshMarket();renderSellPicker();}catch(e){console.warn(e);showToast('Не удалось выставить лот');}
  };
  cancelListing=async function(id){
    if(!await requireOnlineWrite('Рынок'))return;try{const rr=await serverFetch('/api/market?id='+encodeURIComponent(String(id)),{credentials:'include',cache:'no-store'}),pp=await rr.json().catch(()=>null),data=pp?.data;if(!rr.ok||!data)throw new Error(pp?.error||'not found');if(data.seller_id!==state.playerId||data.status!=='active'){showToast('Лот недоступен');return;}const cancelled=await marketApiV10({action:'cancel',listingId:Number(id)});const snap=marketVehicleFromRow(cancelled||data)||state.marketEscrow[String(id)];applyVehicleSnapshot(snap);delete state.marketEscrow[String(id)];showToast('Машина и её сборка возвращены в гараж');saveState();refreshMarket();}catch(e){console.warn(e);showToast('Ошибка снятия лота');}
  };
  buyListing=async function(id){
    if(!await requireOnlineWrite('Рынок'))return;try{const rr=await serverFetch('/api/market?id='+encodeURIComponent(String(id)),{credentials:'include',cache:'no-store'}),pp=await rr.json().catch(()=>null),data=pp?.data;if(!rr.ok||!data||data.status!=='active'){showToast('Лот уже недоступен');refreshMarket();return;}if(data.seller_id===state.playerId)return;const snap=marketVehicleFromRow(data),carId=Number(snap.carId||data.car_id);if(state.ownedCars.includes(carId)||escrowCarIds().has(carId)){showToast('Такая модель уже есть в гараже или находится в вашем лоте');return;}if(state.coins<data.price){showToast('Недостаточно SYND');return;}const sold=await marketApiV10({action:'buy',listingId:Number(id)});if(!sold?.id)throw new Error('listing was not sold');state.coins-=data.price;state.stats.totalSpent+=data.price;applyVehicleSnapshot(snap);showToast('Куплено: машина, тюнинг и установленный номер');updateHeader();saveState();refreshMarket();}catch(e){console.warn(e);showToast('Не удалось купить лот');}
  };
  sellToState=function(carId){if(!state.ownedCars.includes(carId)||state.ownedCars.length<=1)return;const car=carsDB.find(c=>c.id===carId),price=stateSellPrice(car);if(!confirm('Продать '+car.name+' государству за '+fmt(price)+' SYND? Установленный тюнинг и номер уйдут вместе с машиной.'))return;state.coins+=price;state.stats.totalEarned+=price;state.ownedCars=state.ownedCars.filter(id=>id!==carId);if(state.activeCarId===carId)state.activeCarId=state.ownedCars[0];const uid=state.installedPlates[String(carId)];if(uid)state.plateInventory=state.plateInventory.filter(p=>p.uid!==uid);delete state.installedPlates[String(carId)];delete state.upgrades[carId];delete state.fuel[carId];delete state.condition[carId];delete state.tuningHistory[carId];showToast('Машина продана вместе со сборкой');updateHeader();saveState();renderSellPicker();};

  async function reconcileMarketEscrow(){
    if(!onlineAuthReady||!state.playerId)return;
    try{
      const response=await serverFetch('/api/market?scope=mine',{credentials:'include',cache:'no-store'}),payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(payload?.error||('market mine rejected '+response.status));
      const data=(Array.isArray(payload?.data)?payload.data:[]).filter(r=>r.status==='active');let changed=false;
      for(const row of data){
        const key=String(row.id),snap=marketVehicleFromRow(row),carId=Number(snap.carId||row.car_id);
        if(!state.marketEscrow[key]){state.marketEscrow[key]=snap;changed=true;}
        if(state.ownedCars.includes(carId)){
          state.ownedCars=state.ownedCars.filter(id=>id!==carId);
          if(snap?.plate){state.plateInventory=state.plateInventory.filter(p=>p.uid!==snap.plate.uid);delete state.installedPlates[String(carId)];}
          delete state.upgrades[carId];delete state.fuel[carId];delete state.condition[carId];delete state.tuningHistory[carId];
          if(state.activeCarId===carId&&state.ownedCars.length)state.activeCarId=state.ownedCars[0];changed=true;
        }
      }
      if(changed){saveState();updateHeader();}
    }catch(e){console.warn('market reconcile',e);}
  }
  window.reconcileMarketEscrow=reconcileMarketEscrow;

  const baseClaimSoldProceeds=claimSoldProceeds;
  claimSoldProceeds=async function(){
    await baseClaimSoldProceeds();let changed=false;
    Object.keys(state.marketEscrow||{}).forEach(id=>{if((state.claimedSaleIds||[]).includes(Number(id))){delete state.marketEscrow[id];changed=true;}});
    if(changed)saveState();
  };

  /* ---------- REFERRALS ---------- */
  async function referralApi(method='GET',body=null){
    const opts={method,credentials:'include',cache:'no-store',headers:{}};
    if(body!==null){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
    const response=await serverFetch('/api/referrals',opts),payload=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(payload?.error||('referral request rejected '+response.status));
    return payload;
  }
  async function initReferralSystem(){
    if(!onlineAuthReady)return;
    try{
      const ref=new URLSearchParams(location.search).get('ref');
      if(ref&&!state.referral.bound){
        const payload=await referralApi('POST',{action:'bind',code:safeText(ref,'',20).toUpperCase()}),row=payload?.data||{},bonus=Number(row?.invitee_bonus)||0;
        if(bonus>0&&!state.referral.startBonusClaimed){state.coins+=bonus;state.stats.totalEarned+=bonus;state.referral.startBonusClaimed=true;showToast('Реферальный стартовый бонус: +'+fmt(bonus)+' SYND');}
        state.referral.bound=!!row?.bound;saveState();
      }
      await refreshReferralDashboard();await claimReferralRewards();
    }catch(e){console.warn('referral init',e);}
  }
  async function refreshReferralDashboard(){
    if(!onlineAuthReady)return;
    try{const payload=await referralApi('GET'),r=payload?.data;if(!r)return;state.referral.code=safeText(r.referral_code,'',20);state.referral.bound=!!r.has_referrer;state.referral.invites=Number(r.invites)||0;state.referral.earned=Number(r.total_earned)||0;saveState();if(document.getElementById('screen-referrals')?.classList.contains('active'))renderReferrals();}catch(e){console.warn(e);}
  }
  async function claimReferralRewards(){
    if(!onlineAuthReady)return 0;
    try{const payload=await referralApi('POST',{action:'claim'}),amount=Number(payload?.amount)||0;if(amount>0){state.coins+=amount;state.stats.totalEarned+=amount;state.referral.totalClaimed=(state.referral.totalClaimed||0)+amount;showToast('Доход от рефералов: +'+fmt(amount)+' SYND');updateHeader();saveState();return amount;}}catch(e){console.warn(e);}return 0;
  }
  async function claimFirstRaceReferralBonus(){
    if(!onlineAuthReady||state.referral.firstRaceBonusClaimed||state.stats.races<1)return;
    try{const payload=await referralApi('POST',{action:'firstRace'}),amount=Number(payload?.amount)||0;if(amount>0){state.coins+=amount;state.stats.totalEarned+=amount;state.referral.firstRaceBonusClaimed=true;showToast('Подарок за первую гонку: +'+fmt(amount)+' SYND');updateHeader();saveState();}}catch(e){console.warn(e);}
  }
  window.refreshReferralDashboard=refreshReferralDashboard;window.claimReferralRewards=claimReferralRewards;window.claimFirstRaceReferralBonus=claimFirstRaceReferralBonus;
  window.copyReferralLink=async function(){const code=state.referral.code;if(!code)return;const link=location.origin+location.pathname+'?ref='+encodeURIComponent(code);try{await navigator.clipboard.writeText(link);showToast('Реферальная ссылка скопирована');}catch(_){window.prompt('Скопируйте ссылку',link);}};
  window.renderReferrals=function(){ensureV8Screens();const root=document.getElementById('referral-content');if(!root)return;const code=state.referral.code||'—',link=state.referral.code?(location.origin+location.pathname+'?ref='+state.referral.code):'—';root.innerHTML='<div class="referral-hero"><div class="referral-code"><span>ВАШ КОД</span><b>'+escapeHtml(code)+'</b><button onclick="copyReferralLink()">'+svgIcon('copy')+' КОПИРОВАТЬ ССЫЛКУ</button></div><div class="referral-stats"><div><span>Приглашено</span><b>'+fmt(state.referral.invites||0)+'</b></div><div><span>Начислено</span><b>'+fmt(state.referral.earned||0)+' SYND</b></div><div><span>Получено</span><b>'+fmt(state.referral.totalClaimed||0)+' SYND</b></div></div></div><div class="referral-rules"><div class="v8-section-head"><b>КАК РАБОТАЕТ</b><span>5% от заработка</span></div><div class="rule-row"><b>Приглашённый</b><span>Стартовый бонус и отдельный подарок после первой завершённой гонки.</span></div><div class="rule-row"><b>Пригласивший</b><span>Получает 5% от подтверждённого заработка реферала.</span></div><div class="rule-row"><b>Защита</b><span>Самореферал запрещён. Пригласивший закрепляется за игроком один раз.</span></div></div><div class="referral-link-preview">'+escapeHtml(link)+'</div><button class="btn btn-select" onclick="claimReferralRewards();refreshReferralDashboard()">ПРОВЕРИТЬ НАЧИСЛЕНИЯ</button>';
  };
  const basePoll=pollBackgroundClaims;pollBackgroundClaims=function(){basePoll();if(onlineAuthReady)claimReferralRewards();};
  const baseBootstrap=bootstrapOnline;bootstrapOnline=async function(){await baseBootstrap();if(onlineAuthReady){await reconcileMarketEscrow();await syncPlayerProfile(true);await initReferralSystem();}};

  /* ---------- UI SCREENS / ICONS ---------- */
  function ensureCaseModalRoot(){ensureCaseModal();}
  function ensureV8Screens(){
    const main=document.getElementById('main-scroll');if(!main)return;
    if(!document.getElementById('screen-plates')){const s=document.createElement('div');s.id='screen-plates';s.className='screen';s.innerHTML='<div class="back-link" onclick="openDetail(state.tuneTargetId||state.activeCarId)">← К машине</div><div class="section-title"><span>Номера</span></div><div id="plate-content" class="list-container"></div>';main.appendChild(s);}
    if(!document.getElementById('screen-referrals')){const s=document.createElement('div');s.id='screen-referrals';s.className='screen';s.innerHTML='<div class="back-link" onclick="switchTab(\'profile\')">← Профиль</div><div class="section-title"><span>Реферальная система</span></div><div id="referral-content" class="list-container"></div>';main.appendChild(s);}
    ensureCaseModalRoot();
  }
  const baseSwitchTab=switchTab;
  switchTab=function(tabId){if(tabId==='plates'||tabId==='referrals')ensureV8Screens();baseSwitchTab(tabId);if(tabId==='plates')renderPlateScreen(state.tuneTargetId||state.activeCarId);if(tabId==='referrals'){renderReferrals();refreshReferralDashboard();claimReferralRewards();}if(raceCtx?.launchRaf&&tabId!=='race'&&raceCtx.finished)cancelAnimationFrame(raceCtx.launchRaf);};
  const baseRenderProfile=renderProfile;
  renderProfile=function(){baseRenderProfile();ensureV8Screens();const grid=document.querySelector('#screen-profile .hub-grid');if(grid&&!document.getElementById('hub-referral-v8')){const card=document.createElement('div');card.className='hub-card';card.id='hub-referral-v8';card.onclick=()=>switchTab('referrals');card.innerHTML='<div class="ic">'+svgIcon('users')+'</div><div class="lbl">Рефералы</div><div class="sub">5% от заработка</div>';grid.appendChild(card);}replaceHubIcons();};
  function replaceHubIcons(){
    const map=[['districts','map'],['contracts','list'],['jobs','brief'],['achievements','trophy'],['cases','case'],['leaderboard','chart'],['market','tag'],['chat','chat'],['bank','bank'],['settings','gear']];
    map.forEach(([tab,ic])=>{const el=document.querySelector('.hub-card[onclick*="\''+tab+'\'"] .ic');if(el)el.innerHTML=svgIcon(ic);});const daily=document.querySelector('.hub-card[onclick*="openDailyModal"] .ic');if(daily)daily.innerHTML=svgIcon('calendar');
  }
  const baseRenderGarage=renderGarage;renderGarage=function(){baseRenderGarage();document.querySelectorAll('#garage-list .car-card').forEach(card=>{const click=card.querySelector('.car-thumb')?.getAttribute('onclick')||'';const m=click.match(/openDetail\((\d+)\)/);const id=m?Number(m[1]):0;if(!id)return;const p=activePlate(id),info=card.querySelector('.car-title');if(info&&p)info.insertAdjacentHTML('afterend','<div class="garage-plate rar-'+p.rarity+'">'+escapeHtml(p.text)+'</div>');});};

  const baseShowToast=showToast;showToast=function(msg){baseShowToast(sanitizeUiText(msg));};
  const baseManualSave=manualSave;manualSave=function(){saveState();showToast('Прогресс сохранён');};
  const baseExport=exportSave;exportSave=function(){baseExport();};

  /* Fix duplicate achievement definition. */
  for(let i=achievementsDB.length-1;i>=0;i--){if(achievementsDB.findIndex(a=>a.id===achievementsDB[i].id)!==i)achievementsDB.splice(i,1);}
  renderAchievements=function(){const c=document.getElementById('ach-list');if(!c)return;c.innerHTML=achievementsDB.map(a=>{const done=!!state.achievements[a.id];return '<div class="ach-card '+(done?'done':'')+'"><div class="ach-ic">'+svgIcon(done?'shield':'trophy')+'</div><div class="ach-body"><b>'+a.name+'</b><span>'+a.desc+'</span></div><div class="ach-reward">'+(done?'ГОТОВО':'+'+fmt(a.reward)+' SYND')+'</div></div>';}).join('');};

  /* Slot symbols without emoji. */
  try{SLOT_SYMBOLS.splice(0,SLOT_SYMBOLS.length,'CHRY','LEMN','BELL','STAR','DIA','7');Object.keys(SLOT_PAYOUTS).forEach(k=>delete SLOT_PAYOUTS[k]);Object.assign(SLOT_PAYOUTS,{CHRY:3,LEMN:4,BELL:6,STAR:10,DIA:20,'7':50});}catch(_){ }

  document.addEventListener('DOMContentLoaded',()=>{ensureV8Screens();replaceHubIcons();renderProfile();});
})();


/* ===== migrated from carbon_expansion_v9.js ===== */
/* ==================== CARBON DISTRICT 9.0 ====================
   Gear-limited drag physics, 60 FPS race FX, deterministic server case rolls,
   SVG slot reels, expanded profiles, friends and clans.
*/
(function(){
  'use strict';
  const V9_VERSION=9;
  const GEAR_CAPS=[0,40,90,150,215,285,380];
  const GEAR_FLOORS=[0,0,31,72,126,184,246];
  const GEAR_TORQUE=[0,1.20,1.04,.89,.76,.65,.56];
  const RARITY_LABEL_V9={common:'ОБЫЧНЫЙ',rare:'РЕДКИЙ',epic:'ЭПИЧЕСКИЙ',legendary:'ЛЕГЕНДАРНЫЙ',mythic:'МИФИЧЕСКИЙ'};
  const CASES_V9={
    bronze:{id:'bronze',name:'Уличный кейс',price:600,weights:[['common',72],['rare',23],['epic',4.7],['legendary',.3]]},
    silver:{id:'silver',name:'Карбоновый кейс',price:2200,weights:[['common',50],['rare',37],['epic',11.8],['legendary',1.2]]},
    gold:{id:'gold',name:'Кейс Синдиката',price:7000,weights:[['common',35],['rare',42],['epic',20],['legendary',2.7],['mythic',.3]]}
  };
  const CASE_TARGET_INDEX=21;
  const CASE_REEL_LENGTH=27;

  function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
  function rand(){if(globalThis.crypto?.getRandomValues){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]/4294967296;}return Math.random();}
  function localBuildRating(carId){const u=getUpg(Number(carId));const sum=['engine','turbo','gearbox','tires'].reduce((a,k)=>a+(Number(u[k])||0),0);return Math.round(Math.min(100,sum/20*100));}
  function ensureCaseModalV9(){if(document.getElementById('case-open-modal'))return;const d=document.createElement('div');d.id='case-open-modal';d.className='case-open-modal';document.body.appendChild(d);}
  function jsArg(v){return JSON.stringify(String(v??'')).replace(/</g,'\\u003c').replace(/>/g,'\\u003e');}
  function activeCar(){return carsDB.find(c=>c.id===state.activeCarId)||carsDB[0];}
  function playerRating(){
    const car=activeCar();
    const power=car?getEffectivePower(car):0;
    const build=localBuildRating(car?.id||1);
    return Math.max(0,Math.round((Number(state.level)||1)*45+(Number(state.stats?.wins)||0)*18+(Number(state.districtRep)||0)*.32+power*.38+build*6));
  }

  /* ---------- STATE 9 ---------- */
  const v8DefaultState=defaultState;
  const v8NormalizeState=normalizeState;
  defaultState=function(){
    const s=v8DefaultState();
    s.saveVersion=V9_VERSION;
    s.playerUsername='';
    s.stats=s.stats||{};
    s.stats.best0100=0;
    s.caseAppliedRolls=[];
    return s;
  };
  normalizeState=function(raw){
    const out=v8NormalizeState(raw),src=plainObject(raw)?raw:{},stats=plainObject(src.stats)?src.stats:{};
    out.saveVersion=V9_VERSION;
    out.playerUsername=safeText(src.playerUsername,'',32).replace(/^@/,'').replace(/[^A-Za-z0-9_]/g,'');
    out.stats.best0100=finiteNumber(stats.best0100,0,0,120);
    out.caseAppliedRolls=Array.isArray(src.caseAppliedRolls)?[...new Set(src.caseAppliedRolls.slice(-100).map(x=>safeText(String(x),'',64)).filter(Boolean))]:[];
    return out;
  };
  const v8InitTelegram=initTelegram;
  initTelegram=function(){
    v8InitTelegram();
    try{
      const u=window.Telegram?.WebApp?.initDataUnsafe?.user;
      if(u?.username)state.playerUsername=safeText(String(u.username),'',32).replace(/^@/,'').replace(/[^A-Za-z0-9_]/g,'');
    }catch(_){ }
  };

  /* ---------- RACE PHYSICS 9 ---------- */
  const v8PrepareRace=prepareRace;
  prepareRace=function(target,mode){
    v8PrepareRace(target,mode);
    const c=raceCtx;if(!c)return;
    c.gearCaps=GEAR_CAPS.slice();
    c.gearFloors=GEAR_FLOORS.slice();
    c.trackLength=880+Math.floor(rand()*170);
    c.zeroTo100=0;c.stalled=false;c.stallTimer=0;c.throttleKick=0;c.throttleWasDown=false;
    c.lastVisualLead=0;c.overtakes=0;c.fxParticles=null;c.fxCanvas=null;c.fxCtx=null;c.fxW=0;c.fxH=0;
    c.aiGear=1;c.aiRpm=1200;c.aiShiftPause=0;
    renderRaceBrief();
  };

  const v8ChooseLaunch=chooseLaunch;
  chooseLaunch=function(mode){
    v8ChooseLaunch(mode);const c=raceCtx;if(!c)return;
    c.launchQuality=clamp(Number(c.launchQuality)||0,0,1);c.launchImpulse=1.02+c.launchQuality*.22;
    c.speed=0;c.distance=0;c.aiSpeed=0;c.aiDistance=0;c.aiStartDelay=.12+rand()*.22;
    c.rpm=2500+c.launchQuality*3100;
  };

  const v8ShowRaceCockpit=showRaceCockpit;
  showRaceCockpit=function(){
    v8ShowRaceCockpit();
    const c=raceCtx;if(!c)return;
    const map=document.querySelector('#race-content .race-map');
    if(map){
      map.classList.add('race-road-pro');
      if(!map.querySelector('.race-road-lanes'))map.insertAdjacentHTML('afterbegin','<div class="race-road-lanes"><i></i><i></i><i></i></div><div class="race-road-edge left"></div><div class="race-road-edge right"></div>');
      const me=document.getElementById('map-me'),ai=document.getElementById('map-ai');
      if(me&&!me.querySelector('.race-car-shape'))me.innerHTML='<i class="race-car-shape player"><b></b><span></span></i>';
      if(ai&&!ai.querySelector('.race-car-shape'))ai.innerHTML='<i class="race-car-shape rival"><b></b><span></span></i>';
    }
    if(map&&!document.getElementById('race-fx-canvas')){
      const canvas=document.createElement('canvas');canvas.id='race-fx-canvas';canvas.className='race-fx-canvas';canvas.setAttribute('aria-hidden','true');map.prepend(canvas);
      c.fxCanvas=canvas;initRaceFx(c);
    }
    const badge=document.querySelector('#race-content .race-event-badge');
    if(badge&&!document.getElementById('race-gap-visual')){
      badge.insertAdjacentHTML('beforebegin','<div class="race-gap-visual" id="race-gap-visual"><div class="gap-title"><span id="gap-side-left">RIVAL</span><b id="gap-time-label">0.00 s</b><span id="gap-side-right">YOU</span></div><div class="gap-track-v9"><i class="gap-center-v9"></i><i class="gap-fill-v9" id="gap-fill-v9"></i><i class="gap-marker-v9" id="gap-marker-v9"></i></div></div>');
    }
    const help=document.getElementById('shift-help');
    if(help)help.innerHTML='1-я: 40 · 2-я: 90 · 3-я: 150 · 4-я: 215 · 5-я: 285 · 6-я: 380 км/ч';
    updateRaceZones();updateRaceHUD();
  };

  function initRaceFx(c){
    const canvas=c.fxCanvas;if(!canvas)return;
    const lowEnd=!!c.fxLowQuality||(navigator.hardwareConcurrency&&navigator.hardwareConcurrency<=4)||(navigator.deviceMemory&&navigator.deviceMemory<=4);
    c.fxLowQuality=lowEnd;
    const dpr=Math.min(window.devicePixelRatio||1,lowEnd?1:1.15);
    const rect=canvas.getBoundingClientRect();
    const w=Math.max(1,Math.floor(rect.width*dpr)),h=Math.max(1,Math.floor(rect.height*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    c.fxCtx=canvas.getContext('2d',{alpha:true,desynchronized:true});c.fxDpr=dpr;c.fxW=w;c.fxH=h;c.fxMeasureTick=0;c.fxFrameTick=0;
    const count=lowEnd?7:11;
    c.fxParticles=Array.from({length:count},(_,i)=>({x:(i+.5)/count,y:rand(),len:.08+rand()*.16,speed:.65+rand()*.8}));
  }
  function renderRaceFx(c,dt){
    if(!c?.fxCtx||!c.fxCanvas||state.settings?.reducedMotion)return;
    c.fxFrameTick=(c.fxFrameTick||0)+1;if(c.fxLowQuality&&c.fxFrameTick%2)return;
    c.fxMeasureTick=(c.fxMeasureTick||0)+1;
    if(c.fxMeasureTick>=90){c.fxMeasureTick=0;const rect=c.fxCanvas.getBoundingClientRect(),dpr=c.fxDpr||1;const rw=Math.floor(rect.width*dpr),rh=Math.floor(rect.height*dpr);if(Math.abs(rw-c.fxW)>3||Math.abs(rh-c.fxH)>3){initRaceFx(c);}}
    const ctx=c.fxCtx,w=c.fxW,h=c.fxH;ctx.clearRect(0,0,w,h);
    const intensity=clamp((c.speed-55)/250,0,1);if(intensity<=.02)return;
    ctx.globalCompositeOperation='source-over';ctx.lineCap='round';
    const cx=w*.5,cy=h*.42;
    for(const p of c.fxParticles){
      p.y+=dt*p.speed*(.55+intensity*2.5);if(p.y>1.12){p.y=-.12;p.x=.04+rand()*.92;}
      const spread=(p.x-.5),nearY=cy+p.y*h*.72,farY=nearY+p.len*h*(.5+intensity*1.2);
      const nearX=cx+spread*w*(.15+p.y*.8),farX=cx+spread*w*(.18+(p.y+p.len)*.92);
      ctx.strokeStyle='rgba(235,240,230,'+(0.10+intensity*.42)+')';ctx.lineWidth=(.6+intensity*1.5)*dpr;
      ctx.beginPath();ctx.moveTo(nearX,nearY);ctx.lineTo(farX,farY);ctx.stroke();
    }
    if(c.nitroActive||intensity>.82){
      const g=ctx.createRadialGradient(cx,cy,0,cx,cy,Math.max(w,h)*.72);g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(1,'rgba(210,220,205,'+(intensity*.12)+')');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    }
  }

  raceHold=function(type,on){
    if(!raceCtx||raceCtx.finished)return;
    const c=raceCtx;
    if(type==='gas'&&on&&!c.gas){c.throttleKick=.16;const root=document.querySelector('#race-content .race3');if(root){root.classList.remove('throttle-hit');void root.offsetWidth;root.classList.add('throttle-hit');}}
    c[type]=on;
    const b=document.getElementById(type==='gas'?'gas-btn':'brake-btn');if(b)b.classList.toggle('active',on);
  };

  manualShift=function(){
    const c=raceCtx;if(!c||c.finished||c.startLocked)return;
    if(c.gear>=6){showShiftText('6-Я ПЕРЕДАЧА · ФИЗИЧЕСКИЙ ПРЕДЕЛ',false);return;}
    if(c.speed<5&&c.gear===1){
      c.rpm=750;c.stalled=true;c.stallTimer=.72;c.errors++;
      showAction('СТАРТ СО 2-Й ЗАПРЕЩЁН · ДВИГАТЕЛЬ ЗАГЛОХ');showShiftText('ТРОГАТЬСЯ МОЖНО ТОЛЬКО С 1-Й',false);haptic('warning');updateRaceHUD();return;
    }
    const p=c.rpm/c.redline,g=c.profile.greenWidth,y=c.profile.yellowWidth,center=.88;
    const perfect=Math.abs(p-center)<=g,good=Math.abs(p-center)<=y;
    c.shiftCount++;const oldGear=c.gear;c.gear=Math.min(6,c.gear+1);
    if(perfect){
      c.perfectShifts++;c.goodShifts++;c.shiftBoost=1.28+Math.min(.07,c.profile.trans*.012);c.shiftBoostTimer=.62;
      c.speed=Math.min(c.gearCaps[c.gear],c.speed+7.5+c.speed*.035);c.rpm=Math.max(3300,c.rpm*c.profile.shiftRecovery);
      recordContractEvent('perfectShift',1);haptic('success');showAction('ИДЕАЛЬНОЕ ПЕРЕКЛЮЧЕНИЕ · ИМПУЛЬС ТЯГИ');showShiftText('ЗЕЛЁНАЯ ЗОНА · УСКОРЕНИЕ',true);
    }else if(good){
      c.goodShifts++;c.shiftBoost=1.11;c.shiftBoostTimer=.38;c.speed=Math.min(c.gearCaps[c.gear],c.speed+3.2);c.rpm=Math.max(2900,c.rpm*c.profile.shiftRecovery*.94);
      haptic('medium');showAction('ХОРОШЕЕ ПЕРЕКЛЮЧЕНИЕ · ТЯГА СОХРАНЕНА');showShiftText('ЖЁЛТАЯ ЗОНА · ХОРОШИЙ SHIFT',false);
    }else{
      c.errors++;const late=p>.96;c.shiftBoost=Math.max(.84,.76+c.profile.trans*.02);c.shiftBoostTimer=.48;c.speed*=Math.max(.90,.845+c.profile.trans*.014);c.rpm=Math.max(late?2600:1900,c.rpm*(late?.50:.61));
      haptic('warning');showAction((late?'ПОЗДНИЙ':'РАННИЙ')+' SHIFT · ПРОВАЛ ТЯГИ');showShiftText((late?'ПОЗДНО':'РАНО')+' · ПОТЕРЯ УСКОРЕНИЯ',false);
    }
    c.aiShiftPause=Math.max(c.aiShiftPause||0,0);
    const status=document.getElementById('race-status');if(status)status.dataset.lastGear=String(oldGear);
    updateRaceHUD();
  };

  function speedToRpm(speed,gear,redline){
    const floor=GEAR_FLOORS[gear]||0,cap=GEAR_CAPS[gear]||380;
    const t=clamp((speed-floor)/Math.max(1,cap-floor),0,1);
    return 1150+t*(redline-1150);
  }
  function torqueCurve(rpmNorm){
    const x=clamp((rpmNorm-.10)/.90,0,1);
    return .72+Math.sin(x*Math.PI)*.34+x*.08;
  }
  function simulateAiV9(c,dt){
    if(c.elapsed<c.aiStartDelay){c.aiRpm=Math.max(900,c.aiRpm-900*dt);return;}
    if(c.aiShiftPause>0){c.aiShiftPause-=dt;c.aiSpeed=Math.max(0,c.aiSpeed-1.2*dt);return;}
    const gear=c.aiGear||1,cap=GEAR_CAPS[gear],myPower=getEffectivePower(activeCar()),powerRatio=clamp((Number(c.opp.power)||myPower)/Math.max(1,myPower),.68,1.38);
    const style=c.rival?.style||'';let aggression=.96+(powerRatio-1)*.16;if(/Агрессив|Контрат|Босс|давлен/i.test(style))aggression+=.05;
    const gap=c.distance-c.aiDistance;if(gap>8)aggression+=clamp(gap/260,0,.07);if(gap<-20)aggression-=.018;if(c.aiSurgeTimer>0){c.aiSurgeTimer-=dt;aggression+=.06;}
    const rpmNorm=c.aiRpm/c.redline,curve=torqueCurve(rpmNorm),gearTorque=GEAR_TORQUE[gear];
    const hpFactor=Math.sqrt(Math.max(120,Number(c.opp.power)||300)/300);
    const limiter=clamp((cap-c.aiSpeed)/13,.035,1);
    const rate=37*hpFactor*gearTorque*curve*aggression*c.aiSkill*limiter;
    c.aiSpeed+=Math.max(0,rate)*dt;
    c.aiSpeed=Math.min(cap,c.aiSpeed);
    const rpmTarget=speedToRpm(c.aiSpeed,gear,c.redline);c.aiRpm+=(rpmTarget-c.aiRpm)*Math.min(1,dt*9);
    if(c.aiSpeed>=cap-1.1&&gear<6){c.aiGear++;c.aiShiftPause=.075+rand()*.075;c.aiRpm=Math.max(3100,c.aiRpm*(.57+clamp(powerRatio-1,-.2,.2)*.08));c.aiSpeed+=1.8+rand()*2.8;}
    c.aiSpeed=Math.min(GEAR_CAPS[c.aiGear],c.aiSpeed,c.aiMaxSpeed);
    c.aiDistance=Math.min(c.trackLength,c.aiDistance+(c.aiSpeed/3.6)*dt);
  }

  simulateRace=function(dt){
    const c=raceCtx;if(!c||c.startLocked)return;c.elapsed+=dt;
    if(c.nitroTimer>0){c.nitroTimer=Math.max(0,c.nitroTimer-dt);c.nitroActive=c.nitroTimer>0;}
    if(c.shiftBoostTimer>0)c.shiftBoostTimer=Math.max(0,c.shiftBoostTimer-dt);else c.shiftBoost+=(1-c.shiftBoost)*Math.min(1,dt*5.5);
    if(c.actionTimer>0){c.actionTimer-=dt;if(c.actionTimer<=0)document.getElementById('race-action')?.classList.remove('show');}
    if(c.gas&&!c.brake&&c.gear>1&&c.speed<5&&!c.stalled){c.stalled=true;c.stallTimer=.72;c.speed=0;c.rpm=750;c.errors=(c.errors||0)+1;showAction('СТАРТ ТОЛЬКО С 1-Й · ДВИГАТЕЛЬ ЗАГЛОХ');}
    if(c.stalled){
      c.stallTimer-=dt;c.speed=0;c.rpm=Math.max(650,c.rpm-280*dt);
      if(c.stallTimer<=0){c.stalled=false;c.gear=1;c.rpm=1100;showAction('ДВИГАТЕЛЬ ПЕРЕЗАПУЩЕН · 1-Я ПЕРЕДАЧА');}
      simulateAiV9(c,dt);
      return;
    }
    const gear=c.gear||1,gearCap=Math.min(GEAR_CAPS[gear],Math.max(1,c.maxSpeed));
    if(c.gas&&!c.brake){
      const rpmNorm=c.rpm/c.redline,curve=torqueCurve(rpmNorm),car=activeCar(),hp=Math.max(120,getEffectivePower(car));
      const hpFactor=Math.sqrt(hp/300),limiter=clamp((gearCap-c.speed)/12,.025,1),nitro=c.nitroActive?1.19:1,boost=c.shiftBoost||1;
      const launchMul=c.distance<28?(c.launchImpulse||1):1,accelMod=1+(Math.max(1,c.profile.accel)-1)*.58;
      let rate=28.5*hpFactor*GEAR_TORQUE[gear]*curve*accelMod*nitro*boost*limiter*launchMul;
      if(c.throttleKick>0){rate*=1.22;c.throttleKick=Math.max(0,c.throttleKick-dt);}
      const aero=Math.max(0,(c.speed/380)*(c.speed/380))*6.5;
      c.speed+=Math.max(0,rate-aero)*dt;
      c.speed=Math.min(gearCap,c.speed);
      const targetRpm=speedToRpm(c.speed,gear,c.redline);c.rpm+=(targetRpm-c.rpm)*Math.min(1,dt*(8.5+c.profile.rpmRate*2.0));
      if(c.speed>=gearCap-.25)c.rpm=Math.min(c.redline,c.rpm+1000*dt);
    }else{
      c.speed=Math.max(0,c.speed-(4.2+c.speed*.012)*dt);const target=speedToRpm(c.speed,gear,c.redline);c.rpm+=(target-c.rpm)*Math.min(1,dt*5.2);c.rpm=Math.max(950,c.rpm);
    }
    if(c.brake){c.speed=Math.max(0,c.speed-(72+c.speed*.05)*dt);c.rpm=Math.max(900,c.rpm-2500*dt);}
    c.speed=Math.max(0,Math.min(gearCap,c.speed));c.topSpeed=Math.max(c.topSpeed||0,c.speed);
    if(!c.zeroTo100&&c.speed>=100)c.zeroTo100=c.elapsed;
    c.distance=Math.min(c.trackLength,c.distance+(c.speed/3.6)*dt);
    simulateAiV9(c,dt);

    c.eventCooldown-=dt;
    if(c.eventCooldown<=0&&c.elapsed>2.2){
      c.eventCooldown=2.6+rand()*3.6;const gap=c.distance-c.aiDistance;
      if(Math.abs(gap)<14&&rand()<.76){c.aiSurgeTimer=.6+rand()*1.0;showAction(gap>=0?'СОПЕРНИК В ЗЕРКАЛЕ · ДЕРЖИ ИДЕАЛЬНЫЙ SHIFT':'СЛИПСТРИМ · ГОТОВЬ ОБГОН');}
      else if(c.speed>180&&rand()<.48){showAction('СКОРОСТНОЙ УЧАСТОК · ДОРОГА СЖИМАЕТСЯ');}
    }
    if(c.aiDistance>=c.trackLength&&!c.aiFinishedAt)c.aiFinishedAt=c.elapsed;
    if(c.distance>=c.trackLength){c.playerFinishedAt=c.elapsed;finishRace(!c.aiFinishedAt||c.playerFinishedAt<=c.aiFinishedAt,c);}
  };

  updateRaceZones=function(){
    const c=raceCtx;if(!c)return;const centerNorm=.88,center=centerNorm*264-132;
    const greenDeg=Math.max(9,Math.min(34,c.profile.greenWidth*560));
    const yellowDeg=Math.max(greenDeg+13,Math.min(66,c.profile.yellowWidth*560));
    const d=document.getElementById('rpm-dial');if(d){d.style.setProperty('--yellow-start',(center-yellowDeg/2)+'deg');d.style.setProperty('--yellow-end',(center+yellowDeg/2)+'deg');d.style.setProperty('--green-start',(center-greenDeg/2)+'deg');d.style.setProperty('--green-end',(center+greenDeg/2)+'deg');}
  };

  const v8UpdateRaceHUD=updateRaceHUD;
  updateRaceHUD=function(){
    v8UpdateRaceHUD();const c=raceCtx;if(!c)return;
    const cap=c.gearCaps?.[c.gear]||GEAR_CAPS[c.gear]||380;
    const help=document.getElementById('shift-help');if(help)help.textContent='ПЕРЕДАЧА '+c.gear+' · ЛИМИТ '+cap+' КМ/Ч · '+(c.gear<6?'SHIFT В ЗЕЛЁНОЙ ЗОНЕ':'МАКСИМАЛЬНАЯ ПЕРЕДАЧА');
    const gap=c.distance-c.aiDistance,marker=document.getElementById('gap-marker-v9'),fill=document.getElementById('gap-fill-v9'),label=document.getElementById('gap-time-label');
    const pct=clamp(gap/36,-1,1),visual=50+pct*46;
    if(marker){marker.style.left='calc('+visual+'% - 5px)';marker.style.transform='translate3d(0,0,0)';}
    if(fill){fill.style.left=(pct>=0?50:visual)+'%';fill.style.width=(Math.abs(pct)*46)+'%';fill.classList.toggle('behind',pct<0);}
    if(label){const relative=Math.max(5,(c.speed+c.aiSpeed)*.5)/3.6,timeGap=Math.abs(gap)/relative;label.textContent=(gap>=0?'+':'−')+timeGap.toFixed(2)+' s · '+Math.abs(gap).toFixed(1)+' m';label.classList.toggle('behind',gap<0);}
    const sign=gap>1.8?1:gap<-1.8?-1:0;
    if(sign&&c.lastVisualLead&&sign!==c.lastVisualLead&&c.elapsed>1.4){c.overtakes=(c.overtakes||0)+1;const g=document.getElementById('race-gap-visual');if(g){g.classList.remove('overtake');void g.offsetWidth;g.classList.add('overtake');}}
    if(sign)c.lastVisualLead=sign;
    const root=document.querySelector('#race-content .race3');if(root){root.style.setProperty('--race-speed',clamp(c.speed/300,0,1).toFixed(3));root.classList.toggle('speed-200',c.speed>=200);root.classList.toggle('speed-280',c.speed>=280);}
  };

  raceFrame=function(now){
    const c=raceCtx;if(!c||c.finished)return;
    let dt=(now-(c.lastTs||now))/1000;c.lastTs=now;dt=clamp(dt,.001,.05);
    if(document.hidden){c.raf=requestAnimationFrame(raceFrame);return;}
    c.frameEma=c.frameEma?c.frameEma*.94+dt*.06:dt;if(c.frameEma>.022&&!c.fxLowQuality){c.fxLowQuality=true;initRaceFx(c);}
    simulateRace(dt);renderRaceFx(c,dt);c.uiTimer+=dt;
    // DOM updates are capped at 20 Hz; physics and canvas stay on the display RAF.
    if(c.uiTimer>=.05){c.uiTimer=0;updateRaceHUD();}
    if(!c.finished)c.raf=requestAnimationFrame(raceFrame);
  };

  const v8FinishRace=finishRace;
  finishRace=function(won,c){
    if(c?.zeroTo100&&(!state.stats.best0100||c.zeroTo100<state.stats.best0100))state.stats.best0100=Number(c.zeroTo100.toFixed(3));
    v8FinishRace(won,c);
    const result=document.querySelector('#race-content .result-box');
    if(result&&c){const line=document.createElement('div');line.className='race-result-telemetry';line.innerHTML='<span>0–100 <b>'+(c.zeroTo100?c.zeroTo100.toFixed(2)+' с':'0')+'</b></span><span>Обгоны <b>'+(c.overtakes||0)+'</b></span><span>МАКС. <b>'+Math.round(c.topSpeed||0)+' км/ч</b></span>';result.appendChild(line);}
  };

  /* ---------- SERVER-SYNCHRONIZED CASES 9 ---------- */
  function caseContext(){
    const u=getUpg(state.activeCarId),available=['engine','turbo','gearbox','tires'].filter(k=>(Number(u[k])||0)<5);
    return {owned_cars:state.ownedCars.slice(0,100),available_parts:available,active_car_id:state.activeCarId};
  }
  function normalizeServerPrize(raw){
    const p=plainObject(raw)?raw:{};const rarity=['common','rare','epic','legendary','mythic'].includes(p.rarity)?p.rarity:'common',type=['coins','tuning','plate','car'].includes(p.type)?p.type:'coins';
    const out={type,rarity,label:safeText(p.label,'Награда',80)};
    if(type==='coins')out.amount=intNumber(p.amount,1,1,5_000_000);
    if(type==='tuning'){out.part=['engine','turbo','gearbox','tires'].includes(p.part)?p.part:'engine';out.label=({engine:'Двигатель',turbo:'Турбо',gearbox:'КПП',tires:'Шины'}[out.part]||'Тюнинг')+' · +1 УР.';}
    if(type==='car'){out.carId=intNumber(p.carId,0,1,100000);const car=carsDB.find(c=>c.id===out.carId);if(car)out.label=car.name;}
    if(type==='plate')out.plate={uid:safeText(p.plate?.uid,'plate_'+Date.now(),64),text:safeText(p.plate?.text,'X777XX',18),rarity,series:safeText(p.plate?.series,'CASE',24),value:intNumber(p.plate?.value,1000,0,2_000_000),limited:p.plate?.limited===true,createdAt:Date.now()};
    return out;
  }
  function visualRarity(cs){let r=rand()*100,sum=0;for(const [rar,w] of cs.weights){sum+=w;if(r<=sum)return rar;}return cs.weights[0][0];}
  function visualPrize(cs){
    const rarity=visualRarity(cs),t=rand();if(t<.46)return {type:'coins',rarity,label:fmt(Math.round(cs.price*(.4+rand()*2.1)))+' SYND'};
    if(t<.72)return {type:'tuning',rarity,label:['Двигатель','Турбо','КПП','Шины'][Math.floor(rand()*4)]+' · +1 УР.'};
    if(t<.94)return {type:'plate',rarity,label:['A111AA','X777XX','M505MM','K009KK'][Math.floor(rand()*4)]};
    return {type:'car',rarity:rarity==='common'?'rare':rarity,label:'RARE VEHICLE'};
  }
  function v9CaseItemHtml(p){const type=({coins:'КРЕДИТЫ',tuning:'ТЮНИНГ',plate:'НОМЕР',car:'МАШИНА'}[p.type]||'НАГРАДА');const icon=({coins:'coin',tuning:'tune',plate:'plate',car:'car'}[p.type]||'case');return '<div class="case-reel-item rar-'+p.rarity+'"><div class="case-reel-icon">'+svgIcon(icon)+'</div><span>'+RARITY_LABEL_V9[p.rarity]+'</span><b>'+escapeHtml(p.label)+'</b><small>'+type+'</small></div>'; }
  function grantServerCasePrize(prize,cs,rollId){
    if(state.caseAppliedRolls.includes(rollId))return false;
    if(prize.type==='coins'){state.coins+=prize.amount;state.stats.totalEarned+=prize.amount;}
    else if(prize.type==='tuning'){const u=getUpg(state.activeCarId),before=Number(u[prize.part]||0);if(before<5){u[prize.part]=before+1;state.tuningHistory[state.activeCarId]=state.tuningHistory[state.activeCarId]||[];state.tuningHistory[state.activeCarId].push({ts:Date.now(),part:prize.part,level:before+1,price:0,source:'case-v9'});}}
    else if(prize.type==='plate'&&prize.plate){if(!state.plateInventory.some(x=>x.uid===prize.plate.uid))state.plateInventory.push(prize.plate);}
    else if(prize.type==='car'&&carsDB.some(c=>c.id===prize.carId)&&!state.ownedCars.includes(prize.carId)){state.ownedCars.push(prize.carId);getUpg(prize.carId);getFuel(prize.carId);getCondition(prize.carId);}
    state.caseAppliedRolls.push(rollId);state.caseAppliedRolls=state.caseAppliedRolls.slice(-100);
    state.caseHistory.push({ts:Date.now(),caseId:cs.id,label:prize.label,rarity:prize.rarity,type:prize.type});state.caseHistory=state.caseHistory.slice(-60);
    updateHeader();saveState();checkAchievements();return true;
  }
  async function markCaseClaimed(rollId){try{if(!onlineAuthReady)return false;const r=await serverFetch('/api/cases/claim',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({rollId:String(rollId)})});if(!r.ok)throw new Error('claim rejected '+r.status);const body=await r.json().catch(()=>null);return body?.claimed===true;}catch(e){console.warn('case claim mark',e);return false;}}
  async function reconcileCaseRolls(){
    if(state.caseOpening||!onlineAuthReady)return;
    try{
      const response=await serverFetch('/api/cases/pending',{credentials:'include',cache:'no-store'}),payload=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(payload?.error||('pending cases rejected '+response.status));
      const data=Array.isArray(payload?.data)?payload.data:[];
      for(const row of data){
        if(state.caseAppliedRolls.includes(String(row.id))){await markCaseClaimed(row.id);continue;}
        const price=intNumber(row.price,0,0,100000),cs=CASES_V9[row.case_id];if(!cs)continue;
        if(state.coins<price)continue;
        state.coins-=price;state.stats.totalSpent+=price;state.stats.casesOpened++;
        const prize=normalizeServerPrize(row.prize);grantServerCasePrize(prize,cs,String(row.id));await markCaseClaimed(row.id);
        showToast('Восстановлен незавершённый кейс: '+prize.label);
      }
    }catch(e){console.warn('case reconcile',e?.message||e);}
  }

  renderCases=function(){
    const root=document.getElementById('cases-list');if(!root)return;const hist=(state.caseHistory||[]).slice().reverse();
    root.innerHTML=Object.values(CASES_V9).map(cs=>'<div class="case-v8-card"><div class="case-v8-mark">'+svgIcon('case')+'</div><div class="case-v8-body"><div class="case-v8-title"><b>'+cs.name+'</b><span>'+fmt(cs.price)+' SYND</span></div><p>Награда определяется до вращения: предмет под указателем всегда совпадает с полученным призом.</p><div class="case-chances">'+cs.weights.map(([r,w])=>'<span class="rar-'+r+'">'+RARITY_LABEL_V9[r]+' '+w+'%</span>').join('')+'</div><small>Шансы прозрачны и одинаковы для каждого открытия.</small><button class="btn btn-gold" '+(state.coins<cs.price||state.caseOpening?'disabled':'')+' onclick="openCase(\''+cs.id+'\')">ОТКРЫТЬ</button></div></div>').join('')+'<div class="case-history"><div class="v8-section-head"><b>ИСТОРИЯ ОТКРЫТИЙ</b><span>'+hist.length+'</span></div>'+(hist.length?hist.slice(0,12).map(x=>'<div class="history-row"><span class="rar-'+x.rarity+'">'+RARITY_LABEL_V9[x.rarity]+'</span><b>'+escapeHtml(x.label)+'</b><small>'+new Date(x.ts).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</small></div>').join(''):'<div class="empty-note">Кейсы ещё не открывались.</div>')+'</div>';
  };

  openCase=async function(caseId){
    const cs=CASES_V9[caseId];if(!cs||state.caseOpening)return;if(state.coins<cs.price){showToast('Недостаточно SYND');return;}
    if(!await requireOnlineWrite('Кейсы'))return;
    state.caseOpening=true;renderCases();
    try{
      const response=await serverFetch('/api/cases/roll',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId,context:caseContext()})});
      const apiPayload=await response.json().catch(()=>null);if(!response.ok)throw new Error(apiPayload?.error||('server roll rejected '+response.status));
      const payload=apiPayload;const rollId=String(payload?.roll_id||payload?.id||''),prize=normalizeServerPrize(payload?.prize||{}),price=intNumber(payload?.price,cs.price,1,100000);
      if(!rollId)throw new Error('server roll id missing');if(state.coins<price)throw new Error('Недостаточно SYND для подтверждения server roll');
      state.coins-=price;state.stats.totalSpent+=price;state.stats.casesOpened++;saveState();updateHeader();
      const strip=[];for(let i=0;i<CASE_REEL_LENGTH;i++)strip.push(i===CASE_TARGET_INDEX?prize:visualPrize(cs));
      ensureCaseModalV9();const modal=document.getElementById('case-open-modal');modal.classList.add('show');modal.innerHTML='<div class="case-open-shell case-premium-v126"><div class="case-open-head"><div><small>КЕЙС СИНДИКАТА</small><span>'+cs.name+'</span></div><b>ОТКРЫТИЕ</b></div><div class="case-reel-caption"><span>НАГРАДА ЗАФИКСИРОВАНА</span><i></i><span>ПОД УКАЗАТЕЛЕМ</span></div><div class="case-reel-window" id="case-reel-window"><div class="case-pointer-v9"><i></i></div><div class="case-center-line"></div><div class="case-reel-track" id="case-reel-track">'+strip.map(v9CaseItemHtml).join('')+'</div></div><div class="case-open-status" id="case-open-status"><span class="case-spinner"></span><b>ЛЕНТА ЗАПУЩЕНА</b><small>Результат уже сохранён сервером</small></div></div>';
      const track=document.getElementById('case-reel-track'),win=document.getElementById('case-reel-window');
      const finish=async()=>{if(state.caseOpening!==true)return;grantServerCasePrize(prize,cs,rollId);await markCaseClaimed(rollId);const st=document.getElementById('case-open-status');if(st){st.classList.add('case-result-ready');st.innerHTML='<span class="rar-'+prize.rarity+'">'+RARITY_LABEL_V9[prize.rarity]+'</span><b>'+escapeHtml(prize.label)+'</b><small>Награда добавлена в коллекцию</small><button class="btn btn-select" onclick="closeCaseModal()">ЗАБРАТЬ</button>';}state.caseOpening=false;saveState();renderCases();};
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        const item=track?.children?.[CASE_TARGET_INDEX];if(!track||!win||!item){finish();return;}
        const target=win.clientWidth/2-(item.offsetLeft+item.offsetWidth/2);track.style.transform='translate3d('+target+'px,0,0)';
        let done=false;const complete=()=>{if(done)return;done=true;finish();};track.addEventListener('transitionend',complete,{once:true});setTimeout(complete,3400);
      }));
    }catch(e){state.caseOpening=false;console.warn('case roll failed',e);showToast('Не удалось открыть кейс. Попробуйте ещё раз.');renderCases();}
  };

  /* ---------- SVG SLOT MACHINE 9 ---------- */
  const SLOT_V9=[
    {id:'bolt',weight:30,mult:3,label:'BOLT'},
    {id:'diamond',weight:24,mult:4,label:'DIAMOND'},
    {id:'star',weight:18,mult:6,label:'STAR'},
    {id:'crown',weight:13,mult:10,label:'CROWN'},
    {id:'bar',weight:10,mult:20,label:'BAR'},
    {id:'seven',weight:5,mult:50,label:'777'}
  ];
  function slotPick(){const total=SLOT_V9.reduce((a,x)=>a+x.weight,0);let r=rand()*total;for(const s of SLOT_V9){if(r<s.weight)return s;r-=s.weight;}return SLOT_V9[0];}
  function slotSvg(id){
    const paths={
      bolt:'<path d="M13 2 5 13h6l-1 9 9-13h-6z"/>',
      diamond:'<path d="M4 8 8 3h8l4 5-8 13L4 8Z"/><path d="M4 8h16M8 3l4 5 4-5M12 8v13"/>',
      star:'<path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3Z"/>',
      crown:'<path d="m4 7 4 4 4-7 4 7 4-4-2 11H6L4 7Z"/><path d="M6 18h12"/>',
      bar:'<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h10"/>',
      seven:'<path d="M5 5h14l-8 15"/><path d="M6 9h10"/>'
    };
    const label=SLOT_V9.find(s=>s.id===id)?.label||id.toUpperCase();return '<div class="slot-symbol-v9 '+id+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+paths[id]+'</svg><span>'+label+'</span></div>';
  }
  function initSlotsV9(){
    ['reel0','reel1','reel2'].forEach((id,i)=>{const r=document.getElementById(id);if(r&&!r.dataset.v9){r.dataset.v9='1';r.classList.add('reel-v9');r.innerHTML='<div class="slot-strip-v9">'+slotSvg(['bar','seven','diamond'][i])+'</div>';}});
  }
  slotsSpin=function(){
    if(slotsSpinning)return;initSlotsV9();const input=document.getElementById('slots-bet-input'),bet=clampBet(input,10);if(bet>state.coins||bet<10){showToast('Некорректная ставка');return;}
    state.coins-=bet;state.stats.casinoWagered+=bet;updateHeader();saveState();slotsSpinning=true;const final=[slotPick(),slotPick(),slotPick()];const reels=[0,1,2].map(i=>document.getElementById('reel'+i));document.getElementById('slots-message').textContent='Барабаны вращаются...';
    reels.forEach((reel,i)=>{const seq=[];for(let j=0;j<14+i*2;j++)seq.push(slotPick());seq.push(final[i]);const strip=document.createElement('div');strip.className='slot-strip-v9';strip.innerHTML=seq.map(s=>slotSvg(s.id)).join('');reel.innerHTML='';reel.appendChild(strip);strip.style.transitionDuration=(1.05+i*.16)+'s';requestAnimationFrame(()=>requestAnimationFrame(()=>{strip.style.transform='translate3d(0,-'+((seq.length-1)*86)+'px,0)';}));});
    const settle=()=>{let payout=0,msg='Комбинация не сыграла';if(final[0].id===final[1].id&&final[1].id===final[2].id){payout=bet*final[0].mult;msg='ДЖЕКПОТ · '+final[0].label+' ×'+final[0].mult;}else if(final[0].id===final[1].id||final[1].id===final[2].id||final[0].id===final[2].id){payout=Math.round(bet*1.5);msg='ПАРА · ×1.5';}if(payout>0){state.coins+=payout;state.stats.casinoWon+=Math.max(0,payout-bet);flashResult(document.querySelector('#screen-slots'),true);}else flashResult(document.querySelector('#screen-slots'),false);const m=document.getElementById('slots-message');m.textContent=msg+(payout?' · +'+fmt(payout)+' SYND':'');m.style.color=payout>0?'var(--green)':'var(--text-muted)';slotsSpinning=false;updateHeader();saveState();checkAchievements();};
    const last=reels[2]?.querySelector('.slot-strip-v9');if(last){let done=false;const f=()=>{if(done)return;done=true;settle();};last.addEventListener('transitionend',f,{once:true});setTimeout(f,1900);}else settle();
  };

  /* ---------- PROFILES / FRIENDS / CLANS ---------- */
  const v8PlayerProfilePayload=playerProfilePayload;
  playerProfilePayload=function(){
    const p=v8PlayerProfilePayload(),car=activeCar();return {...p,telegram_username:state.playerUsername||null,best_0_100:state.stats.best0100||null,current_car_name:car?.name||null,rating:playerRating()};
  };
  loadPlayerLeaderboard=async function(){
    try{if(!onlineAuthReady&&!await ensureOnlineAuth())return[];const response=await serverFetch('/api/profile/players',{credentials:'include',cache:'no-store'}),payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(payload?.error||('request rejected '+response.status));return Array.isArray(payload?.players)?payload.players:[];}catch(e){console.warn('player leaderboard',e);return[];}
  };
  openPublicProfileByName=async function(name){
    try{if(!onlineAuthReady&&!await ensureOnlineAuth()){showToast('Профиль доступен после входа через Telegram');return;}const clean=safeText(name,'',48);if(!clean)return;const response=await serverFetch('/api/profile/players?q='+encodeURIComponent(clean),{credentials:'include',cache:'no-store'}),payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(payload?.error||('request rejected '+response.status));if(payload?.player)openPublicProfileData(payload.player);else showToast('Профиль игрока не найден');}catch(e){console.warn(e);showToast('Не удалось загрузить профиль');}
  };
  openPublicProfile=function(name,val,wins,races,cars,profile){
    const root=document.getElementById('public-profile-root');if(!root)return;const p=profile||{},wr=races?Math.round(wins/races*100):0,list=Array.isArray(cars)?cars:[].concat(cars||[]).filter(Boolean),ownedHtml=list.length?list.map(x=>'<span class="player-lb-car">'+escapeHtml(x)+'</span>').join(''):'<span class="muted-v9">Нет данных</span>',balance=Number(p.balance??val)||0,level=Number(p.level)||1,best=Number(p.best_0_100)||0,rating=Number(p.rating)||0,current=safeText(p.current_car_name,'',60)||carsDB.find(c=>String(c.id)===String(p.active_car_id))?.name||'Не указана',username=safeText(p.telegram_username,'',32),isSelf=p.id===state.playerId;
    root.innerHTML='<div class="modal-overlay" onclick="if(event.target===this)closePublicProfile()"><div class="public-profile public-profile-v9"><div class="pp-head"><div class="public-avatar">'+(p.photo_url?'<img src="'+escapeAttrLocal(p.photo_url)+'" alt="">':escapeHtml((name||'Г').charAt(0).toUpperCase()))+'</div><div><div class="pp-name-v9">'+escapeHtml(name)+'</div><div class="pp-meta-v9">РЕЙТИНГ '+rating+(username?' · @'+escapeHtml(username):'')+'</div></div></div><div class="pp-grid pp-grid-v9"><div class="pp-stat"><span>Победы</span><b>'+wins+'</b></div><div class="pp-stat"><span>Заезды</span><b>'+races+'</b></div><div class="pp-stat"><span>Процент побед</span><b>'+wr+'%</b></div><div class="pp-stat"><span>Лучший 0–100</span><b>'+(best?best.toFixed(2)+' с':'0')+'</b></div><div class="pp-stat"><span>Текущая машина</span><b>'+escapeHtml(current)+'</b></div><div class="pp-stat"><span>Уровень</span><b>'+level+'</b></div></div><div class="pp-stat pp-garage-v9"><span>Гараж</span><div class="player-lb-cars">'+ownedHtml+'</div></div>'+(!isSelf&&p.id?'<button class="btn btn-select" onclick="sendFriendRequestTo('+jsArg(p.id)+')">ДОБАВИТЬ В ДРУЗЬЯ</button>':'')+'<button class="btn btn-ghost" onclick="closePublicProfile()">ЗАКРЫТЬ</button></div></div>';
  };
  openPublicProfileData=function(p){const owned=Array.isArray(p.owned_cars)?p.owned_cars:[],cars=owned.map(id=>carsDB.find(c=>String(c.id)===String(id))).filter(Boolean);openPublicProfile(p.name,p.total_earned||0,p.wins||0,p.races||0,cars.map(c=>c.name),p);};

  function ensureV9Screens(){
    const main=document.getElementById('main-scroll');if(!main)return;
    if(!document.getElementById('screen-friends')){const s=document.createElement('div');s.id='screen-friends';s.className='screen';s.innerHTML='<div class="back-link" onclick="switchTab(\'profile\')">← Профиль</div><div class="section-title"><span>Друзья</span></div><div class="social-search-v9"><input id="friend-query-v9" maxlength="90" placeholder="ID или @username"><button class="btn btn-select" onclick="sendFriendRequest()">ДОБАВИТЬ</button></div><div id="friends-content-v9" class="list-container"></div>';main.appendChild(s);}
    if(!document.getElementById('screen-clans')){const s=document.createElement('div');s.id='screen-clans';s.className='screen';s.innerHTML='<div class="back-link" onclick="switchTab(\'profile\')">← Профиль</div><div class="section-title"><span>Кланы</span></div><div id="clan-content-v9" class="list-container"></div><div class="section-title clan-ranking-head-v9"><span>Рейтинг кланов</span></div><div class="clan-rank-tabs-v9"><button class="chip-btn active" id="clan-rank-global-v9" onclick="setClanRankMode(\'global\')">ГЛОБАЛЬНЫЙ</button><button class="chip-btn" id="clan-rank-division-v9" onclick="setClanRankMode(\'division\')">ДИВИЗИОН</button></div><div id="clan-leaderboard-v9" class="list-container"></div>';main.appendChild(s);}
  }
  let clanRankMode='global',currentClanDivision='Мантика';
  function onlineFailureMessageV12(code='',fallback='Серверная сессия недоступна'){
    code=String(code||window.__AUTOSYNDICATE_AUTH_ERROR__?.code||'');
    if(code==='DATABASE_MIGRATION_REQUIRED')return'Онлайн-сервисы временно недоступны';
    if(code==='SERVER_CONFIG_INVALID')return'Онлайн-сервисы временно недоступны';
    if(code==='TELEGRAM_INITDATA_MISSING')return'Откройте AutoSyndicate через кнопку в Telegram';
    if(code==='TELEGRAM_AUTH_INVALID')return'Не удалось подтвердить Telegram-профиль';
    if(code==='PLAYER_BANNED')return'Аккаунт заблокирован';
    if(code==='UNAUTHORIZED')return'Сессия истекла. Откройте игру заново';
    return fallback;
  }
  async function socialApi(path,method='GET',body=null,feature='Социальные функции'){
    if(!onlineAuthReady&&!await ensureOnlineAuth()&&!await recoverServerSession())throw new Error(onlineFailureMessageV12());
    if(method!=='GET')void syncPlayerProfile(true);
    const opts={method,credentials:'include',cache:'no-store',headers:{}};
    if(body!==null){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
    const response=await serverFetch(path,opts),payload=await response.json().catch(()=>null);
    if(!response.ok){
      const raw=String(payload?.error||'');
      const code=String(payload?.code||'');
      const human=code?onlineFailureMessageV12(code,raw||'Действие временно недоступно'):(raw==='unauthorized'?'Сессия истекла. Переоткрой Mini App':raw==='player banned'?'Аккаунт заблокирован':raw||'Действие временно недоступно');
      throw new Error(human);
    }
    return payload;
  }

  window.sendFriendRequestTo=async function(playerId){try{await socialApi('/api/social/friends','POST',{action:'request',query:String(playerId)},'Друзья');showToast('Запрос в друзья отправлен');closePublicProfile();await loadFriendsV9();}catch(e){showToast(safeText(e?.message||'Не удалось отправить запрос','Ошибка',100));}};
  window.sendFriendRequest=async function(){const q=document.getElementById('friend-query-v9')?.value||'';if(!q.trim()){showToast('Введи ID или Telegram login');return;}await window.sendFriendRequestTo(q.trim());};
  window.acceptFriendRequest=async function(id){try{await socialApi('/api/social/friends','POST',{action:'accept',friendshipId:Number(id)},'Друзья');showToast('Игрок добавлен в друзья');await loadFriendsV9();}catch(e){showToast(safeText(e?.message||'Ошибка','Ошибка',100));}};
  window.removeFriend=async function(id){try{await socialApi('/api/social/friends','POST',{action:'remove',friendshipId:Number(id)},'Друзья');await loadFriendsV9();}catch(e){showToast(safeText(e?.message||'Ошибка','Ошибка',100));}};
  async function loadFriendsV9(){
    const root=document.getElementById('friends-content-v9');if(!root)return;root.innerHTML='<div class="empty-note">Загрузка...</div>';
    try{const payload=await socialApi('/api/social/friends','GET',null,'Друзья');const rows=Array.isArray(payload?.data)?payload.data:[],incoming=rows.filter(x=>x.status==='pending'&&x.recipient_id===state.playerId),accepted=rows.filter(x=>x.status==='accepted'),outgoing=rows.filter(x=>x.status==='pending'&&x.requester_id===state.playerId);root.innerHTML='<div class="v9-section-head"><b>ДРУЗЬЯ</b><span>'+accepted.length+'</span></div>'+friendRows(accepted,'accepted')+'<div class="v9-section-head"><b>ВХОДЯЩИЕ</b><span>'+incoming.length+'</span></div>'+friendRows(incoming,'incoming')+'<div class="v9-section-head"><b>ИСХОДЯЩИЕ</b><span>'+outgoing.length+'</span></div>'+friendRows(outgoing,'outgoing');}catch(e){console.warn('friends unavailable',e);root.innerHTML='<div class="empty-note">Друзья сейчас недоступны. Попробуйте ещё раз позже.</div>';}
  }
  function friendRows(rows,mode){if(!rows.length)return'<div class="empty-note compact-v9">Нет записей</div>';return rows.map(r=>{const fallback=r.requester_id===state.playerId?{id:r.recipient_id,name:r.recipient_name}:{id:r.requester_id,name:r.requester_name};const p=r.other_profile||fallback,username=p?.telegram_username?'@'+p.telegram_username:'',meta=[p?.id||fallback.id,username,p?.current_car_name||'',p?.rating?('РЕЙТИНГ '+p.rating):''].filter(Boolean).join(' · '),online=r.other_online===true;return '<div class="social-row-v9"><div class="friend-main-v12"><b><i class="friend-online-v12 '+(online?'on':'')+'"></i>'+escapeHtml(p?.name||fallback.name||fallback.id)+'</b><span>'+escapeHtml(meta)+'</span></div><div class="social-actions-v9">'+(mode==='accepted'?'<button class="btn btn-ghost" onclick="openPublicProfileByName('+jsArg(p?.id||fallback.id)+')">ПРОФИЛЬ</button>':'')+(mode==='incoming'?'<button class="btn btn-select" onclick="acceptFriendRequest('+r.id+')">ПРИНЯТЬ</button>':'')+(mode!=='outgoing'?'<button class="btn btn-ghost" onclick="removeFriend('+r.id+')">'+(mode==='accepted'?'УДАЛИТЬ':'ОТКЛОНИТЬ')+'</button>':'<span class="pending-v9">ОЖИДАНИЕ</span>')+'</div></div>';}).join('');}

  let clanLeaderboardCache=[];
  const relationOne=(value)=>Array.isArray(value)?(value[0]||{}):(value||{});
  window.createClanV9=async function(){const n=document.getElementById('clan-name-v9')?.value||'';try{await socialApi('/api/social/clans','POST',{action:'create',name:n},'Кланы');showToast('Клан создан');await loadClanV9();}catch(e){showToast(safeText(e?.message||'Не удалось создать клан','Ошибка',110));}};
  window.inviteClanV9=async function(){const q=document.getElementById('clan-invite-v9')?.value||'';try{await socialApi('/api/social/clans','POST',{action:'invite',query:q},'Кланы');showToast('Приглашение отправлено');await loadClanV9();}catch(e){showToast(safeText(e?.message||'Не удалось пригласить','Ошибка',110));}};
  window.acceptClanInviteV9=async function(id){try{await socialApi('/api/social/clans','POST',{action:'accept',inviteId:Number(id)},'Кланы');showToast('Ты вступил в клан');await loadClanV9();}catch(e){showToast(safeText(e?.message||'Ошибка','Ошибка',110));}};
  window.leaveClanV9=async function(){if(!confirm('Покинуть клан?'))return;try{await socialApi('/api/social/clans','POST',{action:'leave'},'Кланы');showToast('Ты покинул клан');await loadClanV9();}catch(e){showToast(safeText(e?.message||'Ошибка','Ошибка',110));}};
  window.kickClanMemberV9=async function(uid){if(!confirm('Исключить игрока из клана?'))return;try{await socialApi('/api/social/clans','POST',{action:'kick',memberUid:String(uid)},'Кланы');await loadClanV9();}catch(e){showToast(safeText(e?.message||'Ошибка','Ошибка',110));}};
  window.setClanRankMode=function(mode){clanRankMode=mode;document.getElementById('clan-rank-global-v9')?.classList.toggle('active',mode==='global');document.getElementById('clan-rank-division-v9')?.classList.toggle('active',mode==='division');loadClanLeaderboardV9();};

  async function loadClanV9(){
    const root=document.getElementById('clan-content-v9');if(!root)return;root.innerHTML='<div class="empty-note">Загрузка...</div>';
    try{
      const payload=await socialApi('/api/social/clans','GET',null,'Кланы'),membership=payload?.membership||null,invites=Array.isArray(payload?.invites)?payload.invites:[],members=Array.isArray(payload?.members)?payload.members:[],lb=payload?.clanRank||null;clanLeaderboardCache=Array.isArray(payload?.leaderboard)?payload.leaderboard:[];
      if(!membership){root.innerHTML='<div class="clan-create-v9"><b>СОЗДАТЬ КЛАН</b><span>Название уникальное. После создания ты становишься лидером.</span><input id="clan-name-v9" maxlength="24" placeholder="Название клана"><button class="btn btn-select" onclick="createClanV9()">СОЗДАТЬ</button></div>'+renderClanInvites(invites);currentClanDivision='Мантика';loadClanLeaderboardV9();return;}
      const clan=relationOne(membership.clans);currentClanDivision=lb?.division||'Мантика';const isOwner=membership.role==='owner';
      root.innerHTML='<div class="clan-hero-v9"><div><span>КЛАН</span><b>'+escapeHtml(clan.name||'Клан')+'</b><small>'+escapeHtml(currentClanDivision)+' · '+fmt(lb?.score||0)+' очк. · #'+(lb?.global_rank||'—')+'</small></div><button class="btn btn-ghost" onclick="leaveClanV9()">ВЫЙТИ</button></div>'+(isOwner?'<div class="social-search-v9"><input id="clan-invite-v9" maxlength="90" placeholder="ID или @login друга"><button class="btn btn-select" onclick="inviteClanV9()">ПРИГЛАСИТЬ</button></div>':'')+'<div class="v9-section-head"><b>СОСТАВ</b><span>'+members.length+'</span></div>'+members.map(m=>{const profile=relationOne(m.player_profiles);return '<div class="clan-member-v9"><div><b>'+escapeHtml(m.player_name)+'</b><span>'+escapeHtml(({owner:'ВЛАДЕЛЕЦ',officer:'ОФИЦЕР',member:'УЧАСТНИК'}[String(m.role||'member')]||'УЧАСТНИК'))+' · РЕЙТИНГ '+(profile?.rating||0)+' · '+escapeHtml(profile?.current_car_name||'машина не указана')+'</span></div>'+(isOwner&&m.role!=='owner'?'<button class="btn btn-ghost" onclick="kickClanMemberV9('+jsArg(m.member_uid)+')">ИСКЛЮЧИТЬ</button>':'')+'</div>';}).join('')+renderClanInvites(invites);loadClanLeaderboardV9();
    }catch(e){console.warn('clan unavailable',e);root.innerHTML='<div class="empty-note">Клановый раздел сейчас недоступен.</div>';}
  }
  function renderClanInvites(invites){if(!invites.length)return'';return '<div class="v9-section-head"><b>ПРИГЛАШЕНИЯ</b><span>'+invites.length+'</span></div>'+invites.map(i=>{const clan=relationOne(i.clans);return '<div class="social-row-v9"><div><b>'+escapeHtml(clan?.name||'Клан')+'</b><span>Пригласил: '+escapeHtml(i.inviter_name||'Игрок')+'</span></div><button class="btn btn-select" onclick="acceptClanInviteV9('+i.id+')">ВСТУПИТЬ</button></div>';}).join('');}
  async function loadClanLeaderboardV9(){
    const root=document.getElementById('clan-leaderboard-v9');if(!root)return;try{const rows=(clanRankMode==='division'?clanLeaderboardCache.filter(r=>r.division===currentClanDivision):clanLeaderboardCache).slice(0,100);root.innerHTML=rows.length?'<div class="clan-table-v9"><div class="clan-table-row-v9 head"><span>#</span><b>КЛАН</b><span>ЛИГА</span><span>СОСТАВ</span><span>PTS</span></div>'+rows.map((r,i)=>'<div class="clan-table-row-v9"><span>'+(clanRankMode==='global'?(r.global_rank||i+1):(r.division_rank||i+1))+'</span><b>'+escapeHtml(r.name)+'</b><span>'+escapeHtml(r.division)+'</span><span>'+r.members+'</span><strong>'+fmt(r.score)+'</strong></div>').join('')+'</div>':'<div class="empty-note">В этом рейтинге пока нет кланов.</div>';}catch(e){console.warn('clan leaderboard unavailable',e);root.innerHTML='<div class="empty-note">Рейтинг обновляется. Загляните немного позже.</div>';}
  }

  function serverSyncPresentationV12(){
    const connected=onlineAuthReady&&serverReachable&&serverSchemaVersion>=12;
    return connected
      ? {connected:true,title:'ОНЛАЙН',detail:'Профиль синхронизирован'}
      : {connected:false,title:'СЕТЬ НЕДОСТУПНА',detail:'Онлайн-функции восстановятся автоматически'};
  }

  window.retryServerSync=async function(){
    onlineAuthReady=false;serverReachable=true;
    const ok=await recoverServerSession()||await ensureOnlineAuth();
    if(ok){const schemaOk=await checkServerSync();await syncPlayerProfile(true);if(schemaOk)showToast('Онлайн восстановлен');}
    renderProfile();
  };
  const v8RenderProfile=renderProfile;
  renderProfile=function(){
    v8RenderProfile();ensureV9Screens();const grid=document.querySelector('#screen-profile .hub-grid');if(grid&&!document.getElementById('hub-friends-v9')){const a=document.createElement('div');a.className='hub-card';a.id='hub-friends-v9';a.onclick=()=>switchTab('friends');a.innerHTML='<div class="ic">'+svgIcon('users')+'</div><div class="lbl">Друзья</div><div class="sub">Поиск и заявки</div>';grid.appendChild(a);const b=document.createElement('div');b.className='hub-card';b.id='hub-clans-v9';b.onclick=()=>switchTab('clans');b.innerHTML='<div class="ic">'+svgIcon('shield')+'</div><div class="lbl">Кланы</div><div class="sub">Состав и рейтинг</div>';grid.appendChild(b);}
    const hero=document.querySelector('#screen-profile .profile-hero');if(hero&&!document.getElementById('profile-race-stats-v9')){const car=activeCar(),box=document.createElement('div');box.id='profile-race-stats-v9';box.className='profile-race-stats-v9';box.innerHTML='<span>РЕЙТИНГ <b>'+playerRating()+'</b></span><span>0–100 <b>'+(state.stats.best0100?state.stats.best0100.toFixed(2)+' с':'0')+'</b></span><span>МАШИНА <b>'+escapeHtml(car?.name||'Не выбрана')+'</b></span>';hero.appendChild(box);}
    document.getElementById('server-sync-v12')?.remove();
  };

  const v8SwitchTab=switchTab;
  switchTab=function(tabId){ensureV9Screens();if(tabId!=='chat'&&chatPollTimer){clearInterval(chatPollTimer);chatPollTimer=null;}v8SwitchTab(tabId);if(tabId==='slots')initSlotsV9();if(tabId==='friends')loadFriendsV9();if(tabId==='clans')loadClanV9();if(tabId==='cases'){reconcileCaseRolls();}};

  // Run reconciliation after online bootstrap has had time to authenticate.
  const v8PollBackgroundClaims=pollBackgroundClaims;
  pollBackgroundClaims=function(){v8PollBackgroundClaims();if(!document.getElementById('screen-race')?.classList.contains('active'))reconcileCaseRolls();};

  window.addEventListener('resize',()=>{if(raceCtx?.fxCanvas)initRaceFx(raceCtx);},{passive:true});
})();


/* ===== migrated from init.js ===== */
/* ==================== INIT ==================== */
loadState();
initTelegram();
applyUiSettings();
rltInit();
diceUpdate();
updateHeader();
updateAvatarUI();
renderGarage();
window.addEventListener('load', initSupabase);
setTimeout(initSupabase, 1500);
setTimeout(()=>{ if(checkDailyEligible()) openDailyModal(true); }, 900);


/* Legacy DOM callback bridge: compatibility only. */
if (typeof window !== 'undefined') {
  try { Object.defineProperty(window, 'state', { configurable: true, get: () => state, set: (v) => { state = v; } }); } catch {}
  try { (window as any)['defaultState'] = defaultState; } catch {}
  try { (window as any)['finiteNumber'] = finiteNumber; } catch {}
  try { (window as any)['intNumber'] = intNumber; } catch {}
  try { (window as any)['safeText'] = safeText; } catch {}
  try { (window as any)['safePhotoUrl'] = safePhotoUrl; } catch {}
  try { (window as any)['safePlayerId'] = safePlayerId; } catch {}
  try { (window as any)['plainObject'] = plainObject; } catch {}
  try { (window as any)['safeIdArray'] = safeIdArray; } catch {}
  try { (window as any)['validCarIds'] = validCarIds; } catch {}
  try { (window as any)['normalizeRecordNumbers'] = normalizeRecordNumbers; } catch {}
  try { (window as any)['normalizeUpgrades'] = normalizeUpgrades; } catch {}
  try { (window as any)['normalizeAchievements'] = normalizeAchievements; } catch {}
  try { (window as any)['normalizeTournamentRuns'] = normalizeTournamentRuns; } catch {}
  try { (window as any)['normalizeContracts'] = normalizeContracts; } catch {}
  try { (window as any)['normalizeState'] = normalizeState; } catch {}
  try { (window as any)['saveState'] = saveState; } catch {}
  try { (window as any)['loadState'] = loadState; } catch {}
  try { (window as any)['manualSave'] = manualSave; } catch {}
  try { (window as any)['exportSave'] = exportSave; } catch {}
  try { (window as any)['importSave'] = importSave; } catch {}
  try { (window as any)['resetProgress'] = resetProgress; } catch {}
  try { (window as any)['applyUiSettings'] = applyUiSettings; } catch {}
  try { (window as any)['initTelegram'] = initTelegram; } catch {}
  try { (window as any)['escapeAttrLocal'] = escapeAttrLocal; } catch {}
  try { (window as any)['avatarHTML'] = avatarHTML; } catch {}
  try { (window as any)['updateAvatarUI'] = updateAvatarUI; } catch {}
  try { (window as any)['carArtSVG'] = carArtSVG; } catch {}
  try { (window as any)['getUpg'] = getUpg; } catch {}
  try { (window as any)['getEffectivePower'] = getEffectivePower; } catch {}
  try { (window as any)['tuneStagePrice'] = tuneStagePrice; } catch {}
  try { (window as any)['entryFeeFor'] = entryFeeFor; } catch {}
  try { (window as any)['fuelCostFor'] = fuelCostFor; } catch {}
  try { (window as any)['licensePrice'] = licensePrice; } catch {}
  try { (window as any)['generatePlate'] = generatePlate; } catch {}
  try { (window as any)['getFuel'] = getFuel; } catch {}
  try { (window as any)['getCondition'] = getCondition; } catch {}
  try { (window as any)['fuelPricePerUnit'] = fuelPricePerUnit; } catch {}
  try { (window as any)['repairPricePerUnit'] = repairPricePerUnit; } catch {}
  try { (window as any)['refuelCar'] = refuelCar; } catch {}
  try { (window as any)['repairCar'] = repairCar; } catch {}
  try { (window as any)['xpNeeded'] = xpNeeded; } catch {}
  try { (window as any)['addXP'] = addXP; } catch {}
  try { (window as any)['fmt'] = fmt; } catch {}
  try { (window as any)['showToast'] = showToast; } catch {}
  try { (window as any)['flashResult'] = flashResult; } catch {}
  try { (window as any)['tapLogo'] = tapLogo; } catch {}
  try { (window as any)['switchTab'] = switchTab; } catch {}
  try { (window as any)['switchDuelSub'] = switchDuelSub; } catch {}
  try { (window as any)['updateHeader'] = updateHeader; } catch {}
  try { (window as any)['renderGarage'] = renderGarage; } catch {}
  try { (window as any)['renderShop'] = renderShop; } catch {}
  try { (window as any)['buyCar'] = buyCar; } catch {}
  try { (window as any)['selectCar'] = selectCar; } catch {}
  try { (window as any)['openDetail'] = openDetail; } catch {}
  try { (window as any)['goBackFromDetail'] = goBackFromDetail; } catch {}
  try { (window as any)['openTune'] = openTune; } catch {}
  try { (window as any)['upgradeTune'] = upgradeTune; } catch {}
  try { (window as any)['renderOpponents'] = renderOpponents; } catch {}
  try { (window as any)['renderJobs'] = renderJobs; } catch {}
  try { (window as any)['doJob'] = doJob; } catch {}
  try { (window as any)['renderCasinoHub'] = renderCasinoHub; } catch {}
  try { (window as any)['clampBet'] = clampBet; } catch {}
  try { (window as any)['bjAdjustBet'] = bjAdjustBet; } catch {}
  try { (window as any)['bjMaxBet'] = bjMaxBet; } catch {}
  try { (window as any)['bjNewDeck'] = bjNewDeck; } catch {}
  try { (window as any)['bjCardValue'] = bjCardValue; } catch {}
  try { (window as any)['bjRenderCard'] = bjRenderCard; } catch {}
  try { (window as any)['bjRenderHands'] = bjRenderHands; } catch {}
  try { (window as any)['bjDeal'] = bjDeal; } catch {}
  try { (window as any)['bjHit'] = bjHit; } catch {}
  try { (window as any)['bjDouble'] = bjDouble; } catch {}
  try { (window as any)['bjStand'] = bjStand; } catch {}
  try { (window as any)['bjEnd'] = bjEnd; } catch {}
  try { (window as any)['rltAdjustBet'] = rltAdjustBet; } catch {}
  try { (window as any)['rltMaxBet'] = rltMaxBet; } catch {}
  try { (window as any)['rltInit'] = rltInit; } catch {}
  try { (window as any)['rltClearSelection'] = rltClearSelection; } catch {}
  try { (window as any)['rltSelectNumber'] = rltSelectNumber; } catch {}
  try { (window as any)['rltSelectOutside'] = rltSelectOutside; } catch {}
  try { (window as any)['rltSpin'] = rltSpin; } catch {}
  try { (window as any)['slotsAdjustBet'] = slotsAdjustBet; } catch {}
  try { (window as any)['slotsMaxBet'] = slotsMaxBet; } catch {}
  try { (window as any)['weightedSymbol'] = weightedSymbol; } catch {}
  try { (window as any)['slotsSpin'] = slotsSpin; } catch {}
  try { (window as any)['diceUpdate'] = diceUpdate; } catch {}
  try { (window as any)['diceAdjustBet'] = diceAdjustBet; } catch {}
  try { (window as any)['diceMaxBet'] = diceMaxBet; } catch {}
  try { (window as any)['diceRoll'] = diceRoll; } catch {}
  try { (window as any)['checkAchievements'] = checkAchievements; } catch {}
  try { (window as any)['renderAchievements'] = renderAchievements; } catch {}
  try { (window as any)['renderCases'] = renderCases; } catch {}
  try { (window as any)['openCase'] = openCase; } catch {}
  try { (window as any)['renderLeaderboard'] = renderLeaderboard; } catch {}
  try { (window as any)['haptic'] = haptic; } catch {}
  try { (window as any)['renderGarageTools'] = renderGarageTools; } catch {}
  try { (window as any)['setGarageSort'] = setGarageSort; } catch {}
  try { (window as any)['quickRefuelActive'] = quickRefuelActive; } catch {}
  try { (window as any)['quickRepairActive'] = quickRepairActive; } catch {}
  try { (window as any)['renderShopToolbar'] = renderShopToolbar; } catch {}
  try { (window as any)['setShopCategory'] = setShopCategory; } catch {}
  try { (window as any)['addHeat'] = addHeat; } catch {}
  try { (window as any)['reduceHeat'] = reduceHeat; } catch {}
  try { (window as any)['heatLabel'] = heatLabel; } catch {}
  try { (window as any)['renderHeatStrip'] = renderHeatStrip; } catch {}
  try { (window as any)['dayKeyLocal'] = dayKeyLocal; } catch {}
  try { (window as any)['hashDay'] = hashDay; } catch {}
  try { (window as any)['getActiveContracts'] = getActiveContracts; } catch {}
  try { (window as any)['ensureContracts'] = ensureContracts; } catch {}
  try { (window as any)['contractStatus'] = contractStatus; } catch {}
  try { (window as any)['recordContractEvent'] = recordContractEvent; } catch {}
  try { (window as any)['renderContracts'] = renderContracts; } catch {}
  try { (window as any)['claimContract'] = claimContract; } catch {}
  try { (window as any)['currentDistrict'] = currentDistrict; } catch {}
  try { (window as any)['recordCareerRace'] = recordCareerRace; } catch {}
  try { (window as any)['renderDistricts'] = renderDistricts; } catch {}
  try { (window as any)['recordRaceTelemetry'] = recordRaceTelemetry; } catch {}
  try { (window as any)['renderRecentRaceSummary'] = renderRecentRaceSummary; } catch {}
  try { (window as any)['renderSettings'] = renderSettings; } catch {}
  try { (window as any)['toggleSetting'] = toggleSetting; } catch {}
  try { (window as any)['checkDailyEligible'] = checkDailyEligible; } catch {}
  try { (window as any)['openDailyModal'] = openDailyModal; } catch {}
  try { (window as any)['claimDaily'] = claimDaily; } catch {}
  try { (window as any)['closeDailyModal'] = closeDailyModal; } catch {}
  try { (window as any)['renderProfile'] = renderProfile; } catch {}
  try { (window as any)['awardMoney'] = awardMoney; } catch {}
  try { (window as any)['openPublicProfile'] = openPublicProfile; } catch {}
  try { (window as any)['openPublicProfileData'] = openPublicProfileData; } catch {}
  try { (window as any)['closePublicProfile'] = closePublicProfile; } catch {}
  try { (window as any)['raceTuneProfile'] = raceTuneProfile; } catch {}
  try { (window as any)['prepareRace'] = prepareRace; } catch {}
  try { (window as any)['renderRaceBrief'] = renderRaceBrief; } catch {}
  try { (window as any)['beginLaunch'] = beginLaunch; } catch {}
  try { (window as any)['chooseLaunch'] = chooseLaunch; } catch {}
  try { (window as any)['showRaceCockpit'] = showRaceCockpit; } catch {}
  try { (window as any)['startTrafficLight'] = startTrafficLight; } catch {}
  try { (window as any)['showAction'] = showAction; } catch {}
  try { (window as any)['raceHold'] = raceHold; } catch {}
  try { (window as any)['manualShift'] = manualShift; } catch {}
  try { (window as any)['showShiftText'] = showShiftText; } catch {}
  try { (window as any)['raceFrame'] = raceFrame; } catch {}
  try { (window as any)['simulateRace'] = simulateRace; } catch {}
  try { (window as any)['useRaceNitro'] = useRaceNitro; } catch {}
  try { (window as any)['updateRaceZones'] = updateRaceZones; } catch {}
  try { (window as any)['updateRaceHUD'] = updateRaceHUD; } catch {}
  try { (window as any)['finishRace'] = finishRace; } catch {}
  try { (window as any)['triggerPoliceStop'] = triggerPoliceStop; } catch {}
  try { (window as any)['closePoliceModal'] = closePoliceModal; } catch {}
  try { (window as any)['policeChoice'] = policeChoice; } catch {}
  try { (window as any)['buyBackLicense'] = buyBackLicense; } catch {}
  try { (window as any)['initSupabase'] = initSupabase; } catch {}
  try { (window as any)['ensureOnlineAuth'] = ensureOnlineAuth; } catch {}
  try { (window as any)['recoverServerSession'] = recoverServerSession; } catch {}
  try { (window as any)['checkServerSync'] = checkServerSync; } catch {}
  try { (window as any)['serverFetch'] = serverFetch; } catch {}
  try { (window as any)['bootstrapOnline'] = bootstrapOnline; } catch {}
  try { (window as any)['requireOnlineWrite'] = requireOnlineWrite; } catch {}
  try { (window as any)['pollBackgroundClaims'] = pollBackgroundClaims; } catch {}
  try { (window as any)['playerProfilePayload'] = playerProfilePayload; } catch {}
  try { (window as any)['syncPlayerProfile'] = syncPlayerProfile; } catch {}
  try { (window as any)['loadPlayerLeaderboard'] = loadPlayerLeaderboard; } catch {}
  try { (window as any)['openPublicProfileByName'] = openPublicProfileByName; } catch {}
  try { (window as any)['switchMarketSub'] = switchMarketSub; } catch {}
  try { (window as any)['openMarket'] = openMarket; } catch {}
  try { (window as any)['subscribeMarket'] = subscribeMarket; } catch {}
  try { (window as any)['refreshMarket'] = refreshMarket; } catch {}
  try { (window as any)['renderMarketList'] = renderMarketList; } catch {}
  try { (window as any)['renderSellPicker'] = renderSellPicker; } catch {}
  try { (window as any)['stateSellPrice'] = stateSellPrice; } catch {}
  try { (window as any)['promptListCar'] = promptListCar; } catch {}
  try { (window as any)['listCarForSale'] = listCarForSale; } catch {}
  try { (window as any)['cancelListing'] = cancelListing; } catch {}
  try { (window as any)['buyListing'] = buyListing; } catch {}
  try { (window as any)['sellToState'] = sellToState; } catch {}
  try { (window as any)['claimSoldProceeds'] = claimSoldProceeds; } catch {}
  try { (window as any)['renderMyListings'] = renderMyListings; } catch {}
  try { (window as any)['openChat'] = openChat; } catch {}
  try { (window as any)['escapeHtml'] = escapeHtml; } catch {}
  try { (window as any)['appendChatMessage'] = appendChatMessage; } catch {}
  try { (window as any)['loadChatHistory'] = loadChatHistory; } catch {}
  try { (window as any)['subscribeChat'] = subscribeChat; } catch {}
  try { (window as any)['sendChatMessage'] = sendChatMessage; } catch {}
  try { (window as any)['openBank'] = openBank; } catch {}
  try { (window as any)['bankSentToday'] = bankSentToday; } catch {}
  try { (window as any)['bankCooldownLeft'] = bankCooldownLeft; } catch {}
  try { (window as any)['sendBankTransfer'] = sendBankTransfer; } catch {}
  try { (window as any)['claimBankTransfers'] = claimBankTransfers; } catch {}
  try { (window as any)['renderBankLog'] = renderBankLog; } catch {}
  try { (window as any)['openPvp'] = openPvp; } catch {}
  try { (window as any)['refreshPvpList'] = refreshPvpList; } catch {}
  try { (window as any)['postPvpChallenge'] = postPvpChallenge; } catch {}
  try { (window as any)['cancelPvpChallenge'] = cancelPvpChallenge; } catch {}
  try { (window as any)['acceptPvpChallenge'] = acceptPvpChallenge; } catch {}
  try { (window as any)['resolvePvpChallenge'] = resolvePvpChallenge; } catch {}
  try { (window as any)['claimPvpResults'] = claimPvpResults; } catch {}
}

/* ==================== v11 CONTENT + DUEL NETWORK ==================== */
(() => {
  const bootstrap=(window as any).__AUTOSYNDICATE_CONTENT__ || {};
  if(Array.isArray(bootstrap.cars) && bootstrap.cars.length){
    const normalized=bootstrap.cars.filter((c:any)=>c&&Number.isInteger(Number(c.id))).map((c:any)=>({
      id:Number(c.id),name:String(c.name||`CAR ${c.id}`),image:c.image?String(c.image):null,price:Number(c.price)||0,power:Number(c.power)||100,
      tier:String(c.tier||'Street'),cat:String(c.cat||'street'),flavor:String(c.flavor||'')
    }));
    carsDB.splice(0,carsDB.length,...normalized);applyEconomyCarPrices(carsDB);
    const activeIds=new Set(carsDB.map((c:any)=>Number(c.id)));
    state.ownedCars=(state.ownedCars||[]).filter((id:any)=>activeIds.has(Number(id)));
    if(!state.ownedCars.length && carsDB[0]) state.ownedCars=[carsDB[0].id];
    if(!state.ownedCars.includes(state.activeCarId)) state.activeCarId=state.ownedCars[0];
    saveState();
  }
  if(Array.isArray(bootstrap.opponents) && bootstrap.opponents.length){
    const merged=new Map(opponentsDB.map((o:any)=>[String(o.id),o]));
    bootstrap.opponents.forEach((o:any)=>{
      const normalized={
        id:o.id,name:String(o.name||'Соперник'),power:Number(o.power)||200,reward:Number(o.reward)||0,unlockLevel:Number(o.unlockLevel)||1,
        car:String(o.car||'Уличная сборка'),rating:Number(o.rating)||50,style:String(o.style||'Сбалансированный'),favoriteTracks:Array.isArray(o.favoriteTracks)?o.favoriteTracks:['Промзона'],
        wins:Number(o.wins)||0,losses:Number(o.losses)||0,avatar:String(o.avatar||'AI'),taunt:String(o.taunt||''),preLines:Array.isArray(o.preLines)?o.preLines:[],
        winLine:String(o.winLine||''),loseLine:String(o.loseLine||''),boss:o.boss===true
      };
      merged.set(String(o.id),{...(merged.get(String(o.id))||{}),...normalized});
    });
    opponentsDB.splice(0,opponentsDB.length,...Array.from(merged.values()));
  }
  opponentsDB.forEach((o:any)=>{o.reward=economyRaceReward(o);});
  tournamentsDB.forEach((o:any)=>{o.reward=Math.round(economyRaceReward(o)*2.8);o.entryFee=Math.max(120,Math.round(o.reward*.18));});

  function rivalMetaV11(opp:any){
    const rec=state.rivalRecords?.[String(opp?.id)]||{wins:0,losses:0};
    const name=String(opp?.name||'Соперник');
    return {
      avatar:String(opp?.avatar||name.slice(0,2).toUpperCase()),
      style:String(opp?.style||'Сбалансированный'),
      favoriteTracks:Array.isArray(opp?.favoriteTracks)&&opp.favoriteTracks.length?opp.favoriteTracks:['Промзона'],
      wins:Number(opp?.wins)||0,
      losses:Number(opp?.losses)||0,
      car:String(opp?.car||'Уличная сборка'),
      rating:Number(opp?.rating)||Math.min(99,Math.round(50+(Number(opp?.power)||200)/18)),
      record:rec
    };
  }

  let duelFilter='all';
  let duelPage=0;
  const DUEL_PAGE_SIZE=6;
  (window as any).setDuelFilter=(filter:string)=>{
    duelFilter=['all','equal','risk','boss'].includes(filter)?filter:'all';duelPage=0;
    document.querySelectorAll('[data-duel-filter]').forEach((el:any)=>el.classList.toggle('active',el.dataset.duelFilter===duelFilter));
    renderOpponents();
  };
  (window as any).setDuelPage=(delta:number)=>{duelPage=Math.max(0,duelPage+Number(delta||0));renderOpponents();};

  const switchDuelSubV11=switchDuelSub;
  switchDuelSub=function(sub){
    switchDuelSubV11(sub);duelPage=0;
    const filters=document.getElementById('duel-filter-wrap');
    const summary=document.getElementById('duel-match-summary');
    if(filters)filters.style.display=sub==='normal'?'flex':'none';
    if(summary)summary.style.display=sub==='pvp'?'none':'';
  };

  renderOpponents=function(){
    updateHeader();
    const root=document.getElementById('opponent-list'),summary=document.getElementById('duel-match-summary');if(!root)return;
    root.innerHTML='';
    const car=carsDB.find((x:any)=>x.id===state.activeCarId);
    if(!car){root.innerHTML='<div class="empty-note">Выберите активную машину.</div>';return;}
    if(state.licenseSuspended){root.innerHTML='<div class="empty-note">Нет допуска к заездам. Восстановите права в профиле.</div>';return;}
    const myPower=getEffectivePower(car),history=state.raceHistory||[];
    let pool=(state.duelSub==='tour'?tournamentsDB:opponentsDB).filter((o:any)=>state.level>=Number(o.unlockLevel||1));
    if(state.duelSub==='tour'){
      const now=Date.now(),day=new Date().toISOString().slice(0,10);
      pool=pool.filter((o:any)=>{const r=state.tournamentRuns[String(o.id)]||{};const count=r.day===day?(Number(r.count)||0):0,next=r.day===day?(Number(r.next)||0):0;return count<3&&next<=now;});
    }else{
      if(duelFilter==='equal')pool=pool.filter((o:any)=>Math.abs(Number(o.power)-myPower)/Math.max(myPower,1)<=.18&&!o.boss);
      if(duelFilter==='risk')pool=pool.filter((o:any)=>Number(o.power)>myPower*1.08&&!o.boss);
      if(duelFilter==='boss')pool=pool.filter((o:any)=>o.boss);
      pool=pool.slice().sort((a:any,b:any)=>duelFilter==='risk'||duelFilter==='boss'?Number(a.power)-Number(b.power):Math.abs(Number(a.power)-myPower)-Math.abs(Number(b.power)-myPower));
    }
    const pageSize=state.duelSub==='tour'?3:DUEL_PAGE_SIZE,totalPages=Math.max(1,Math.ceil(pool.length/pageSize));duelPage=Math.min(duelPage,totalPages-1);
    const visible=pool.slice(duelPage*pageSize,duelPage*pageSize+pageSize);
    if(summary){summary.innerHTML='<div class="summary-main"><div class="summary-car">'+escapeHtml(String(car.name).split(/\s+/).slice(0,2).map((x:any)=>x[0]).join('').slice(0,3))+'</div><div><b>'+escapeHtml(car.name)+'</b><span>'+fmt(myPower)+' л.с. · '+pool.length+' доступно</span></div></div>'+(state.duelSub==='tour'?'':'<div class="duel-pager"><button '+(duelPage<=0?'disabled':'')+' onclick="setDuelPage(-1)">‹</button><b>'+(duelPage+1)+' / '+totalPages+'</b><button '+(duelPage>=totalPages-1?'disabled':'')+' onclick="setDuelPage(1)">›</button></div>');}
    const onlineLabel=document.getElementById('duel-online-label');if(onlineLabel)onlineLabel.textContent=pool.length+' соперников';
    if(!visible.length){root.innerHTML='<div class="empty-note">Под этот фильтр соперников нет.</div>';return;}
    root.innerHTML=visible.map((opp:any,idx:number)=>{
      const m=rivalMetaV11(opp),delta=(Number(opp.power)-myPower)/Math.max(myPower,1),winChance=Math.max(4,Math.min(96,Math.round(50-delta*82))),fee=entryFeeFor(opp),recent=history.includes(String(opp.id));
      const r=state.tournamentRuns[String(opp.id)]||{},day=new Date().toISOString().slice(0,10),count=state.duelSub==='tour'&&r.day===day?(Number(r.count)||0):0,mult=state.duelSub==='tour'?([1,.72,.48][Math.min(2,count)]||.48):1,reward=Math.round(Number(opp.reward||0)*mult);
      const cls=opp.boss?'boss extreme':delta>.28?'extreme':delta>.08?'risk':delta<-.15?'easy':'even',label=opp.boss?'БОСС':delta>.28?'ПРЕДЕЛ':delta>.08?'РИСК':delta<-.15?'ПРЕИМУЩЕСТВО':'РАВНО';
      return '<article class="duel-card-v126 '+cls+'" style="animation-delay:'+Math.min(idx*22,150)+'ms"><div class="duel-avatar-v126">'+escapeHtml(m.avatar)+'</div><div class="duel-info-v126"><div class="duel-name-v126"><b>'+escapeHtml(opp.name)+'</b><span class="'+(cls.includes('extreme')?'extreme':cls.includes('risk')?'risk':'')+'">'+label+'</span></div><small>'+escapeHtml(m.car)+' · '+escapeHtml(m.style)+'</small><div class="duel-bar-v126"><i style="width:'+winChance+'%"></i></div><div class="duel-meta-v126"><span>Рейтинг <b>'+m.rating+'</b></span><span>Шанс <b>'+winChance+'%</b></span><span>Серия <b>'+m.record.wins+'–'+m.record.losses+'</b></span></div></div><div class="duel-power-v126"><b>'+fmt(opp.power)+'</b><span>л.с.</span><small>'+(Number(opp.power)>=myPower?'+':'')+Math.round(Number(opp.power)-myPower)+'</small></div><div class="duel-action-v126"><div><span>Вход <b>'+fmt(fee)+'</b></span><span>Приз <b>'+fmt(reward)+'</b></span></div><button onclick="prepareRace(\''+String(opp.id).replace(/'/g,"\\'")+'\',\''+(state.duelSub==='tour'?'tour':'normal')+'\')">ВЫЗВАТЬ</button>'+(recent?'<small>Недавний заезд</small>':'')+'</div></article>';
    }).join('');
  };

  const finishRaceV11=finishRace;
  finishRace=function(playerWins:any,cArg:any){
    const ctx=cArg||raceCtx;
    const privateCode=ctx?.privateDuelCode;
    const result=privateCode?{elapsedMs:Math.round(Number(ctx.elapsed||0)*1000),topSpeedKmh:Number(ctx.topSpeed||ctx.speed||0),perfectShifts:Number(ctx.perfectShifts||0),missedShifts:Number(ctx.errors||0)}:null;
    finishRaceV11(playerWins,cArg);
    if(privateCode&&result){
      serverFetch('/api/duels/room',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'submitResult',code:privateCode,...result})})
        .then(r=>r.json()).then(payload=>window.dispatchEvent(new CustomEvent('autosyndicate:duel-result',{detail:payload}))).catch(()=>{});
    }
  };

  (window as any).__AUTOSYNDICATE_START_PRIVATE_DUEL__=(payload:any)=>{
    try{
      const room=payload.room||{},role=payload.role,mySide=role==='a'?'a':'b',otherSide=role==='a'?'b':'a';
      const myCarId=Number(room['player_'+mySide+'_car_id']),otherCarId=Number(room['player_'+otherSide+'_car_id']);
      if(!state.ownedCars.includes(myCarId)){showToast('Эта машина недоступна в вашем гараже');return;}
      state.activeCarId=myCarId;saveState();updateHeader();renderGarage();
      const otherProfile=(payload.profiles||[]).find((p:any)=>p.id===room['player_'+otherSide+'_id'])||{};
      const otherCar=(payload.selectedCars||[]).find((c:any)=>Number(c.id)===otherCarId)||{};
      const tempId='private_'+String(room.public_code);
      const temp={id:tempId,name:String(otherProfile.name||room['player_'+otherSide+'_name']||'Игрок'),power:Number(otherCar.power)||getEffectivePower(carsDB.find((c:any)=>c.id===myCarId)),reward:0,unlockLevel:1,car:String(otherCar.name||'Private build'),rating:Number(otherProfile.rating)||0,style:'Онлайн-дуэль',favoriteTracks:['Закрытая комната'],wins:0,losses:0,avatar:String(otherProfile.name||'P').slice(0,2).toUpperCase(),taunt:'Дуэль из Telegram-чата.',preLines:['Комната закрыта. На линии только вы двое.']};
      const existing=opponentsDB.findIndex((o:any)=>String(o.id)===tempId);if(existing>=0)opponentsDB[existing]=temp;else opponentsDB.push(temp);
      prepareRace(tempId,'normal');
      if(raceCtx){raceCtx.privateDuelCode=String(room.public_code);raceCtx.fee=0;raceCtx.fuelCost=0;raceCtx.opp.reward=0;raceCtx.mode='private';renderRaceBrief();}
    }catch(_){showToast('Не удалось открыть приватный заезд');}
  };

  (window as any).switchDuelSub=switchDuelSub;
  (window as any).renderOpponents=renderOpponents;
  (window as any).finishRace=finishRace;
  renderGarage();renderShop();if(document.getElementById('screen-duel-select')?.classList.contains('active'))renderOpponents();
})();
