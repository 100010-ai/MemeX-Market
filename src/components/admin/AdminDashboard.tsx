'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { bootstrapSecureSession } from '@/features/auth/client';

type Tab = 'overview' | 'players' | 'cars' | 'opponents' | 'bot' | 'settings';
type JsonRecord = Record<string, unknown>;

interface AdminPlayer {
  id: string;
  name: string;
  telegram_username?: string | null;
  level: number;
  balance: number;
  races: number;
  wins: number;
  losses: number;
  rating: number;
  current_car_name?: string | null;
  last_seen?: string | null;
  banned_at?: string | null;
  ban_reason?: string | null;
  owned_cars?: number[];
}

interface AdminCar {
  id: number;
  name: string;
  image_path?: string | null;
  price: number;
  power: number;
  tier: string;
  category: string;
  flavor?: string | null;
  active: boolean;
  sort_order: number;
}

interface AdminOpponent {
  key: string;
  name: string;
  power: number;
  reward: number;
  unlock_level: number;
  car_name: string;
  rating: number;
  style: string;
  favorite_tracks?: string[];
  wins: number;
  losses: number;
  avatar: string;
  taunt?: string | null;
  pre_lines?: string[];
  win_line?: string | null;
  lose_line?: string | null;
  boss: boolean;
  active: boolean;
  sort_order: number;
}

interface BotCommandRow {
  command: string;
  response_text: string;
  enabled: boolean;
  parse_mode: 'HTML' | 'MarkdownV2' | 'plain';
  button_label?: string | null;
  button_url?: string | null;
}

interface GameSettingRow { key: string; value: unknown; }
interface TopBalanceRow { id: string; name: string; balance: number; }
interface TopRatingRow { id: string; name: string; rating: number; }
interface TopEarnedRow { id: string; name: string; total_earned: number; }
interface RecentRaceRow { id: string; player_id: string; route: string; won: boolean; elapsed_ms: number; top_speed_kmh: number; verified: boolean; }
interface AuditRow { admin_player_id: string; action: string; target_type: string; target_id?: string | null; created_at: string; }

interface AdminStats {
  players: number;
  activePlayers15m: number;
  races: number;
  races24h: number;
  activeListings: number;
  clans: number;
  caseRolls: number;
  activeDuels: number;
  bannedPlayers: number;
  botUpdates24h: number;
  serverSchemaVersion: number;
  syncMode: string;
  telegramProfiles: number;
  telegramPrincipals: number;
  principalCoverage: number;
  totalBalance: number;
  totalEarned: number;
  averageBalance: number;
  averageRating: number;
  averageRaceMs24h: number;
  verifiedRaces24h: number;
  verifiedRate24h: number;
  avgTopSpeed24h: number;
  globalWinRate: number;
  duelStatus24h: Record<string, number>;
  topBalance: TopBalanceRow[];
  topRating: TopRatingRow[];
  topEarned: TopEarnedRow[];
  recentRaces: RecentRaceRow[];
  recentAudit: AuditRow[];
}

interface CarForm {
  id: number; name: string; imagePath: string; price: number; power: number; tier: string; category: string;
  flavor: string; active: boolean; sortOrder: number;
}
interface OpponentForm {
  key: string; name: string; power: number; reward: number; unlockLevel: number; carName: string; rating: number;
  style: string; favoriteTracks: string; wins: number; losses: number; avatar: string; taunt: string; preLines: string;
  winLine: string; loseLine: string; boss: boolean; active: boolean; sortOrder: number;
}
interface CommandForm {
  command: string; responseText: string; enabled: boolean; parseMode: 'HTML' | 'MarkdownV2' | 'plain'; buttonLabel: string; buttonUrl: string;
}

const initialCar: CarForm = { id: 28, name: '', imagePath: '', price: 10000, power: 500, tier: 'Sport Tier 4', category: 'sport', flavor: '', active: true, sortOrder: 100 };
const initialOpponent: OpponentForm = { key: 'npc_new', name: '', power: 500, reward: 900, unlockLevel: 2, carName: 'Уличная сборка', rating: 75, style: 'Агрессивный', favoriteTracks: 'Промзона, Тоннель', wins: 40, losses: 20, avatar: 'NP', taunt: '', preLines: 'Готов?', winLine: 'Ещё увидимся.', loseLine: 'Хороший заезд.', boss: false, active: true, sortOrder: 100 };
const initialCommand: CommandForm = { command: 'help', responseText: 'Команды AutoSyndicate', enabled: true, parseMode: 'HTML', buttonLabel: '', buttonUrl: '' };

async function request<T extends JsonRecord>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include', cache: 'no-store', ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) }
  });
  const payload = await response.json().catch(() => null) as (T & { ok?: boolean; error?: string }) | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
  return payload;
}

function formatNumber(value: number) { return Number(value || 0).toLocaleString('ru-RU'); }
function formatDate(value?: string | null) { return value ? new Date(value).toLocaleString('ru-RU') : '—'; }

export function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('overview');
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [cars, setCars] = useState<AdminCar[]>([]);
  const [opponents, setOpponents] = useState<AdminOpponent[]>([]);
  const [commands, setCommands] = useState<BotCommandRow[]>([]);
  const [settings, setSettings] = useState<GameSettingRow[]>([]);
  const [query, setQuery] = useState('');
  const [carForm, setCarForm] = useState<CarForm>(initialCar);
  const [opponentForm, setOpponentForm] = useState<OpponentForm>(initialOpponent);
  const [commandForm, setCommandForm] = useState<CommandForm>(initialCommand);
  const [settingForm, setSettingForm] = useState({ key: 'race.reward_multiplier', value: '1' });

  async function loadAll() {
    const [statsPayload, playersPayload, carsPayload, opponentsPayload, commandsPayload, settingsPayload] = await Promise.all([
      request<{ ok: boolean; stats: AdminStats }>('/api/admin/stats'),
      request<{ ok: boolean; players: AdminPlayer[] }>('/api/admin/players'),
      request<{ ok: boolean; cars: AdminCar[] }>('/api/admin/content/cars'),
      request<{ ok: boolean; opponents: AdminOpponent[] }>('/api/admin/content/opponents'),
      request<{ ok: boolean; commands: BotCommandRow[] }>('/api/admin/bot/commands'),
      request<{ ok: boolean; settings: GameSettingRow[] }>('/api/admin/settings')
    ]);
    setStats(statsPayload.stats);
    setPlayers(playersPayload.players);
    setCars(carsPayload.cars);
    setOpponents(opponentsPayload.opponents);
    setCommands(commandsPayload.commands);
    setSettings(settingsPayload.settings);
  }

  useEffect(() => {
    void (async () => {
      try {
        const authenticated = await bootstrapSecureSession();
        if (!authenticated) throw new Error('Открой Control Center из Telegram через /admin');
        await loadAll();
        setReady(true);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Нет доступа');
      }
    })();
  }, []);

  async function playerAction(body: JsonRecord) {
    try {
      await request('/api/admin/players', { method: 'POST', body: JSON.stringify(body) });
      await loadAll();
      setNotice('Изменение сохранено');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Ошибка'); }
  }

  const filteredPlayers = useMemo(() => {
    const normalized = query.toLocaleLowerCase('ru-RU').trim();
    if (!normalized) return players;
    return players.filter((player) => `${player.id} ${player.name} ${player.telegram_username || ''}`.toLocaleLowerCase('ru-RU').includes(normalized));
  }, [players, query]);

  if (!ready) return <main className="admin-root"><div className="admin-auth-card"><b>AUTOSYNDICATE CONTROL</b><span>{notice || 'Проверка Telegram-администратора…'}</span></div></main>;

  const nav: Array<[Tab, string]> = [['overview','Обзор'],['players','Игроки'],['cars','Машины'],['opponents','Соперники'],['bot','Telegram Bot'],['settings','Настройки']];

  return <main className="admin-root">
    <header className="admin-header"><div><b>AUTOSYNDICATE</b><span>CONTROL CENTER v12</span></div><a href="/">В игру</a></header>
    <div className="admin-layout">
      <aside className="admin-sidebar">{nav.map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</aside>
      <section className="admin-content">
        {notice && <div className="admin-alert" onClick={() => setNotice('')}>{notice}</div>}

        {tab === 'overview' && stats && <>
          <div className="admin-title"><div><span>Система</span><h1>Обзор проекта</h1></div><button onClick={() => void loadAll()}>Обновить</button></div>
          <div className="admin-stat-grid">
            {[
              ['Игроки', stats.players], ['Онлайн ~15м', stats.activePlayers15m], ['Активные дуэли', stats.activeDuels], ['Всего гонок', stats.races],
              ['Кланы', stats.clans], ['Активные лоты', stats.activeListings], ['Открытия кейсов', stats.caseRolls], ['Забанено', stats.bannedPlayers],
              ['SYND в обороте', stats.totalBalance], ['Всего заработано', stats.totalEarned], ['Средний баланс', stats.averageBalance], ['Средний рейтинг', stats.averageRating],
              ['Процент побед', `${stats.globalWinRate}%`], ['Версия схемы', `v${stats.serverSchemaVersion || 0}`], ['Telegram-профили', `${stats.telegramPrincipals}/${stats.telegramProfiles}`], ['Связано профилей', `${stats.principalCoverage}%`]
            ].map(([label, value]) => <div className="admin-stat" key={String(label)}><span>{label}</span><b>{typeof value === 'number' ? formatNumber(value) : String(value)}</b></div>)}
          </div>
          <div className="admin-kpi-row admin-kpi-wide">
            <span>Гонки 24ч <b>{formatNumber(stats.races24h)}</b></span>
            <span>Verified <b>{stats.verifiedRate24h}%</b></span>
            <span>Среднее время <b>{stats.averageRaceMs24h ? `${(stats.averageRaceMs24h / 1000).toFixed(2)} c` : '—'}</b></span>
            <span>Средняя Vmax <b>{stats.avgTopSpeed24h} км/ч</b></span>
            <span>Bot updates <b>{formatNumber(stats.botUpdates24h)}</b></span>
            <span>Дуэли 24ч <b>{formatNumber(Object.values(stats.duelStatus24h || {}).reduce((a, b) => a + b, 0))}</b></span>
          </div>
          <div className="admin-analytics-grid">
            <div className="admin-panel"><h2>Топ по балансу</h2><div className="admin-mini-list">{stats.topBalance.map((player, index) => <div key={player.id}><span>#{index + 1} · {player.name}</span><b>{formatNumber(player.balance)} SYND</b></div>)}</div></div>
            <div className="admin-panel"><h2>Топ по рейтингу</h2><div className="admin-mini-list">{stats.topRating.map((player, index) => <div key={player.id}><span>#{index + 1} · {player.name}</span><b>{player.rating} RP</b></div>)}</div></div>
            <div className="admin-panel"><h2>Топ по заработку</h2><div className="admin-mini-list">{stats.topEarned.map((player, index) => <div key={player.id}><span>#{index + 1} · {player.name}</span><b>{formatNumber(player.total_earned)} SYND</b></div>)}</div></div>
          </div>
          <div className="admin-panel"><h2>Последние серверные гонки</h2><div className="admin-mini-table">{stats.recentRaces.map((race) => <div key={race.id}><span>{race.player_id}</span><span>{race.route}</span><span className={race.won ? 'ok' : 'bad'}>{race.won ? 'WIN' : 'LOSS'}</span><b>{(Number(race.elapsed_ms) / 1000).toFixed(3)} c</b><small>{Math.round(Number(race.top_speed_kmh))} км/ч · {race.verified ? 'verified' : 'unverified'}</small></div>)}</div></div>
          <div className="admin-analytics-grid">
            <div className="admin-panel"><h2>Дуэли за 24 часа</h2><div className="admin-mini-list">{Object.entries(stats.duelStatus24h || {}).map(([status, count]) => <div key={status}><span>{status}</span><b>{count}</b></div>)}</div></div>
            <div className="admin-panel"><h2>Audit log</h2><div className="admin-mini-list">{stats.recentAudit.map((row, index) => <div key={`${row.created_at}-${index}`}><span>{row.action} · {row.target_type}{row.target_id ? `:${row.target_id}` : ''}</span><b>{formatDate(row.created_at)}</b></div>)}</div></div>
          </div>
          <div className="admin-panel"><h2>Telegram webhook</h2><p>Webhook защищён secret-token заголовком и update_id idempotency. После смены домена, webhook secret или bot token зарегистрируй webhook заново.</p><button className="admin-primary" onClick={() => void request('/api/telegram/setup-webhook', { method: 'POST', body: '{}' }).then(() => setNotice('Webhook зарегистрирован')).catch((error: Error) => setNotice(error.message))}>Зарегистрировать webhook</button></div>
        </>}

        {tab === 'players' && <>
          <div className="admin-title"><div><span>Модерация и экономика</span><h1>Игроки</h1></div><b>{filteredPlayers.length} / {players.length}</b></div>
          <input className="admin-search" placeholder="ID, имя или @username" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Игрок</th><th>Баланс</th><th>Статистика</th><th>Рейтинг</th><th>Действия</th></tr></thead><tbody>
            {filteredPlayers.map((player) => <tr key={player.id}>
              <td><b>{player.name}</b><small>{player.id}{player.telegram_username ? ` · @${player.telegram_username}` : ''}</small><small>Последний вход: {formatDate(player.last_seen)}</small>{player.banned_at && <em>ЗАБАНЕН · {player.ban_reason || 'Без причины'}</em>}</td>
              <td>{formatNumber(player.balance)} SYND</td><td>{player.wins}W / {player.losses}L · {player.races} гонок · LVL {player.level}</td><td>{player.rating}</td>
              <td><div className="admin-actions">
                <button onClick={() => void playerAction({ action: 'addBalance', playerId: player.id, amount: 10000 })}>+10K</button>
                <button onClick={() => { const value = Number(window.prompt('Новый баланс', String(player.balance))); if (Number.isFinite(value)) void playerAction({ action: 'setBalance', playerId: player.id, balance: Math.max(0, Math.trunc(value)) }); }}>Баланс</button>
                <button onClick={() => { const value = Number(window.prompt('ID машины', '1')); if (Number.isFinite(value)) void playerAction({ action: 'grantCar', playerId: player.id, carId: Math.trunc(value) }); }}>+ Машина</button>
                <button className={player.banned_at ? 'ok' : 'danger'} onClick={() => player.banned_at ? void playerAction({ action: 'unban', playerId: player.id }) : void playerAction({ action: 'ban', playerId: player.id, reason: window.prompt('Причина бана', 'Нарушение правил') || 'Нарушение правил' })}>{player.banned_at ? 'Разбан' : 'Бан'}</button>
              </div></td>
            </tr>)}
          </tbody></table></div>
        </>}

        {tab === 'cars' && <>
          <div className="admin-title"><div><span>Контент</span><h1>Машины</h1></div><b>{cars.filter((car) => car.active).length} active</b></div>
          <div className="admin-two">
            <form className="admin-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void request('/api/admin/content/cars', { method: 'POST', body: JSON.stringify({ ...carForm, imagePath: carForm.imagePath || null }) }).then(loadAll).then(() => setNotice('Машина сохранена')).catch((error: Error) => setNotice(error.message)); }}>
              <h2>Добавить / изменить машину</h2>
              <label><span>ID</span><input type="number" value={carForm.id} onChange={(event) => setCarForm({ ...carForm, id: Number(event.target.value) })} /></label>
              <label><span>Название</span><input value={carForm.name} onChange={(event) => setCarForm({ ...carForm, name: event.target.value })} /></label>
              <label><span>Изображение /assets/…</span><input value={carForm.imagePath} onChange={(event) => setCarForm({ ...carForm, imagePath: event.target.value })} /></label>
              <div className="admin-form-row"><label><span>Цена</span><input type="number" value={carForm.price} onChange={(event) => setCarForm({ ...carForm, price: Number(event.target.value) })} /></label><label><span>Мощность</span><input type="number" value={carForm.power} onChange={(event) => setCarForm({ ...carForm, power: Number(event.target.value) })} /></label></div>
              <div className="admin-form-row"><label><span>Tier</span><input value={carForm.tier} onChange={(event) => setCarForm({ ...carForm, tier: event.target.value })} /></label><label><span>Категория</span><input value={carForm.category} onChange={(event) => setCarForm({ ...carForm, category: event.target.value })} /></label></div>
              <label><span>Описание</span><textarea value={carForm.flavor} onChange={(event) => setCarForm({ ...carForm, flavor: event.target.value })} /></label>
              <div className="admin-form-row"><label><span>Sort order</span><input type="number" value={carForm.sortOrder} onChange={(event) => setCarForm({ ...carForm, sortOrder: Number(event.target.value) })} /></label><label className="admin-check"><span>Active</span><input type="checkbox" checked={carForm.active} onChange={(event) => setCarForm({ ...carForm, active: event.target.checked })} /></label></div>
              <button className="admin-primary">Сохранить машину</button>
            </form>
            <div className="admin-list">{cars.map((car) => <button key={car.id} className={!car.active ? 'muted' : ''} onClick={() => setCarForm({ id: car.id, name: car.name, imagePath: car.image_path || '', price: car.price, power: car.power, tier: car.tier, category: car.category, flavor: car.flavor || '', active: car.active, sortOrder: car.sort_order })}><b>#{car.id} · {car.name}</b><span>{car.power} л.с. · {car.tier} · {formatNumber(car.price)} SYND · {car.active ? 'ВКЛ' : 'ВЫКЛ'}</span></button>)}</div>
          </div>
        </>}

        {tab === 'opponents' && <>
          <div className="admin-title"><div><span>Контент гонок</span><h1>Соперники</h1></div><b>{opponents.length} total</b></div>
          <div className="admin-two">
            <form className="admin-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const body = { ...opponentForm, favoriteTracks: opponentForm.favoriteTracks.split(',').map((item) => item.trim()).filter(Boolean), preLines: opponentForm.preLines.split('\n').map((item) => item.trim()).filter(Boolean) }; void request('/api/admin/content/opponents', { method: 'POST', body: JSON.stringify(body) }).then(loadAll).then(() => setNotice('Соперник сохранён')).catch((error: Error) => setNotice(error.message)); }}>
              <h2>Добавить / изменить соперника</h2>
              <div className="admin-form-row"><label><span>Key</span><input value={opponentForm.key} onChange={(event) => setOpponentForm({ ...opponentForm, key: event.target.value.toLowerCase() })} /></label><label><span>Имя</span><input value={opponentForm.name} onChange={(event) => setOpponentForm({ ...opponentForm, name: event.target.value })} /></label></div>
              <div className="admin-form-row"><label><span>Мощность</span><input type="number" value={opponentForm.power} onChange={(event) => setOpponentForm({ ...opponentForm, power: Number(event.target.value) })} /></label><label><span>Награда</span><input type="number" value={opponentForm.reward} onChange={(event) => setOpponentForm({ ...opponentForm, reward: Number(event.target.value) })} /></label></div>
              <div className="admin-form-row"><label><span>Unlock lvl</span><input type="number" value={opponentForm.unlockLevel} onChange={(event) => setOpponentForm({ ...opponentForm, unlockLevel: Number(event.target.value) })} /></label><label><span>Rating</span><input type="number" value={opponentForm.rating} onChange={(event) => setOpponentForm({ ...opponentForm, rating: Number(event.target.value) })} /></label></div>
              <label><span>Машина</span><input value={opponentForm.carName} onChange={(event) => setOpponentForm({ ...opponentForm, carName: event.target.value })} /></label>
              <label><span>Стиль</span><input value={opponentForm.style} onChange={(event) => setOpponentForm({ ...opponentForm, style: event.target.value })} /></label>
              <label><span>Любимые трассы, через запятую</span><input value={opponentForm.favoriteTracks} onChange={(event) => setOpponentForm({ ...opponentForm, favoriteTracks: event.target.value })} /></label>
              <div className="admin-form-row"><label><span>История W</span><input type="number" value={opponentForm.wins} onChange={(event) => setOpponentForm({ ...opponentForm, wins: Number(event.target.value) })} /></label><label><span>История L</span><input type="number" value={opponentForm.losses} onChange={(event) => setOpponentForm({ ...opponentForm, losses: Number(event.target.value) })} /></label></div>
              <label><span>Avatar initials</span><input value={opponentForm.avatar} onChange={(event) => setOpponentForm({ ...opponentForm, avatar: event.target.value.toUpperCase().slice(0, 8) })} /></label>
              <label><span>Провокация</span><textarea value={opponentForm.taunt} onChange={(event) => setOpponentForm({ ...opponentForm, taunt: event.target.value })} /></label>
              <label><span>Pre-lines, по одной на строку</span><textarea value={opponentForm.preLines} onChange={(event) => setOpponentForm({ ...opponentForm, preLines: event.target.value })} /></label>
              <label><span>Фраза после победы</span><input value={opponentForm.winLine} onChange={(event) => setOpponentForm({ ...opponentForm, winLine: event.target.value })} /></label>
              <label><span>Фраза после поражения</span><input value={opponentForm.loseLine} onChange={(event) => setOpponentForm({ ...opponentForm, loseLine: event.target.value })} /></label>
              <div className="admin-form-row"><label><span>Sort</span><input type="number" value={opponentForm.sortOrder} onChange={(event) => setOpponentForm({ ...opponentForm, sortOrder: Number(event.target.value) })} /></label><label className="admin-check"><span>Boss</span><input type="checkbox" checked={opponentForm.boss} onChange={(event) => setOpponentForm({ ...opponentForm, boss: event.target.checked })} /></label><label className="admin-check"><span>Active</span><input type="checkbox" checked={opponentForm.active} onChange={(event) => setOpponentForm({ ...opponentForm, active: event.target.checked })} /></label></div>
              <button className="admin-primary">Сохранить соперника</button>
            </form>
            <div className="admin-list">{opponents.map((opponent) => <button key={opponent.key} className={!opponent.active ? 'muted' : ''} onClick={() => setOpponentForm({ key: opponent.key, name: opponent.name, power: opponent.power, reward: opponent.reward, unlockLevel: opponent.unlock_level, carName: opponent.car_name, rating: opponent.rating, style: opponent.style, favoriteTracks: (opponent.favorite_tracks || []).join(', '), wins: opponent.wins, losses: opponent.losses, avatar: opponent.avatar, taunt: opponent.taunt || '', preLines: (opponent.pre_lines || []).join('\n'), winLine: opponent.win_line || '', loseLine: opponent.lose_line || '', boss: opponent.boss, active: opponent.active, sortOrder: opponent.sort_order })}><b>{opponent.boss ? 'БОСС · ' : ''}{opponent.name}</b><span>{opponent.car_name} · {opponent.power} л.с. · РЕЙТИНГ {opponent.rating} · {opponent.active ? 'ВКЛ' : 'ВЫКЛ'}</span></button>)}</div>
          </div>
        </>}

        {tab === 'bot' && <>
          <div className="admin-title"><div><span>Webhook engine</span><h1>Команды бота</h1></div><b>{commands.filter((command) => command.enabled).length} active</b></div>
          <div className="admin-two">
            <form className="admin-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void request('/api/admin/bot/commands', { method: 'POST', body: JSON.stringify({ ...commandForm, buttonLabel: commandForm.buttonLabel || null, buttonUrl: commandForm.buttonUrl || null }) }).then(loadAll).then(() => setNotice('Команда сохранена')).catch((error: Error) => setNotice(error.message)); }}>
              <h2>Команда</h2>
              <label><span>/command</span><input value={commandForm.command} onChange={(event) => setCommandForm({ ...commandForm, command: event.target.value.replace(/^\//, '').toLowerCase() })} /></label>
              <label><span>Ответ</span><textarea value={commandForm.responseText} onChange={(event) => setCommandForm({ ...commandForm, responseText: event.target.value })} /></label>
              <label><span>Parse mode</span><select value={commandForm.parseMode} onChange={(event) => setCommandForm({ ...commandForm, parseMode: event.target.value as CommandForm['parseMode'] })}><option value="HTML">HTML</option><option value="MarkdownV2">MarkdownV2</option><option value="plain">Plain</option></select></label>
              <label className="admin-check"><span>Команда включена</span><input type="checkbox" checked={commandForm.enabled} onChange={(event) => setCommandForm({ ...commandForm, enabled: event.target.checked })} /></label>
              <label><span>Inline-кнопка</span><input value={commandForm.buttonLabel} onChange={(event) => setCommandForm({ ...commandForm, buttonLabel: event.target.value })} /></label>
              <label><span>URL кнопки</span><input value={commandForm.buttonUrl} onChange={(event) => setCommandForm({ ...commandForm, buttonUrl: event.target.value })} /></label>
              <div className="admin-hint">Шаблоны: {'{first_name}'} · {'{username}'} · {'{app_url}'} · {'{args}'} · {'{user_id}'} · {'{chat_id}'}</div>
              <button className="admin-primary">Сохранить команду</button>
            </form>
            <div className="admin-list">{commands.map((command) => <div className="admin-command" key={command.command}><button onClick={() => setCommandForm({ command: command.command, responseText: command.response_text, enabled: command.enabled, parseMode: command.parse_mode, buttonLabel: command.button_label || '', buttonUrl: command.button_url || '' })}><b>/{command.command}</b><span>{command.enabled ? 'ВКЛ' : 'ВЫКЛ'} · {command.parse_mode} · {command.response_text.slice(0, 90)}</span></button>{command.command !== 'start' && <button className="danger" onClick={() => void request('/api/admin/bot/commands', { method: 'DELETE', body: JSON.stringify({ command: command.command }) }).then(loadAll).catch((error: Error) => setNotice(error.message))}>Удалить</button>}</div>)}</div>
          </div>
        </>}

        {tab === 'settings' && <>
          <div className="admin-title"><div><span>Feature flags / balance</span><h1>Настройки игры</h1></div><b>{settings.length} keys</b></div>
          <div className="admin-two">
            <form className="admin-form compact" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); let value: unknown = settingForm.value; try { value = JSON.parse(settingForm.value); } catch { /* plain string */ } void request('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: settingForm.key, value }) }).then(loadAll).then(() => setNotice('Настройка сохранена')).catch((error: Error) => setNotice(error.message)); }}>
              <label><span>Ключ</span><input value={settingForm.key} onChange={(event) => setSettingForm({ ...settingForm, key: event.target.value })} /></label>
              <label><span>JSON / значение</span><textarea value={settingForm.value} onChange={(event) => setSettingForm({ ...settingForm, value: event.target.value })} /></label>
              <button className="admin-primary">Сохранить</button>
            </form>
            <div className="admin-list settings">{settings.map((setting) => <button key={setting.key} onClick={() => setSettingForm({ key: setting.key, value: JSON.stringify(setting.value, null, 2) })}><b>{setting.key}</b><span>{JSON.stringify(setting.value)}</span></button>)}</div>
          </div>
        </>}
      </section>
    </div>
  </main>;
}
