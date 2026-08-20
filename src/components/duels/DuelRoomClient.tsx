'use client';

import { useEffect, useMemo, useState } from 'react';

interface DuelRoom {
  public_code: string;
  status: 'pending'|'accepted'|'ready'|'racing'|'finished'|'declined'|'cancelled'|'expired';
  player_a_id: string;
  player_b_id: string;
  player_a_name: string;
  player_b_name: string;
  player_a_car_id?: number | null;
  player_b_car_id?: number | null;
  player_a_ready: boolean;
  player_b_ready: boolean;
  player_a_result?: DuelResult | null;
  player_b_result?: DuelResult | null;
  winner_player_id?: string | null;
  start_at?: string | null;
}

interface DuelResult {
  elapsedMs: number;
  topSpeedKmh: number;
  perfectShifts: number;
  missedShifts: number;
  submittedAt?: string;
}

interface DuelProfile {
  id: string;
  name: string;
  photo_url?: string | null;
  level: number;
  rating: number;
  current_car_name?: string | null;
}

interface DuelCar {
  id: number;
  name: string;
  image_path?: string | null;
  power: number;
  tier: string;
  category: string;
}

export interface RoomPayload {
  ok: boolean;
  room: DuelRoom;
  profiles: DuelProfile[];
  cars: DuelCar[];
  selectedCars: DuelCar[];
  role: 'a'|'b';
  error?: string;
}

declare global {
  interface Window {
    __AUTOSYNDICATE_START_PRIVATE_DUEL__?: (payload: RoomPayload) => void;
  }
}

export function DuelRoomClient({ code, onClose }: { code: string; onClose: () => void }) {
  const [data, setData] = useState<RoomPayload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [enteredRace, setEnteredRace] = useState(false);

  async function load() {
    const response = await fetch(`/api/duels/room?code=${encodeURIComponent(code)}`, { credentials: 'include', cache: 'no-store' });
    const payload = await response.json().catch(() => null) as RoomPayload | null;
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Не удалось открыть комнату');
    setData(payload);
    setError('');
  }

  useEffect(() => {
    let stopped = false;
    void load().catch((reason: unknown) => !stopped && setError(reason instanceof Error ? reason.message : 'Ошибка комнаты'));
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void load().catch(() => {}); }, 1800);
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => { stopped = true; clearInterval(poll); clearInterval(tick); };
  }, [code]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch('/api/duels/room', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ code, ...body }) });
      const payload = await response.json().catch(() => null) as RoomPayload | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Операция не выполнена');
      setData(payload); setError('');
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : 'Ошибка'); }
    finally { setBusy(false); }
  }

  const meId = data?.role === 'a' ? data.room.player_a_id : data?.room.player_b_id;
  const otherId = data?.role === 'a' ? data.room.player_b_id : data?.room.player_a_id;
  const me = data?.profiles.find((profile) => profile.id === meId);
  const other = data?.profiles.find((profile) => profile.id === otherId);
  const myCarId = data?.role === 'a' ? data?.room.player_a_car_id : data?.room.player_b_car_id;
  const otherCarId = data?.role === 'a' ? data?.room.player_b_car_id : data?.room.player_a_car_id;
  const myReady = data?.role === 'a' ? data?.room.player_a_ready : data?.room.player_b_ready;
  const otherReady = data?.role === 'a' ? data?.room.player_b_ready : data?.room.player_a_ready;
  const myResult = data?.role === 'a' ? data?.room.player_a_result : data?.room.player_b_result;
  const otherResult = data?.role === 'a' ? data?.room.player_b_result : data?.room.player_a_result;
  const otherCar = data?.selectedCars.find((car) => car.id === otherCarId);
  const startMs = data?.room.start_at ? new Date(data.room.start_at).getTime() : 0;
  const countdown = startMs ? Math.max(0, Math.ceil((startMs - now) / 1000)) : null;
  const canEnterRace = Boolean(data?.room.status === 'racing' && startMs > 0 && now >= startMs);

  const statusText = useMemo(() => {
    if (!data) return 'Загрузка';
    if (data.room.status === 'accepted') return 'Выберите машины';
    if (data.room.status === 'ready') return 'Ожидание готовности';
    if (data.room.status === 'racing') return countdown && countdown > 0 ? `Старт через ${countdown}` : myResult ? 'Ждём соперника' : 'Старт открыт';
    if (data.room.status === 'finished') return 'Дуэль завершена';
    return String(data.room.status);
  }, [data, countdown, myResult]);

  useEffect(() => {
    if (!canEnterRace || enteredRace || !data || myResult) return;
    setEnteredRace(true);
    window.__AUTOSYNDICATE_START_PRIVATE_DUEL__?.(data);
    onClose();
  }, [canEnterRace, enteredRace, data, myResult, onClose]);

  const finished = data?.room.status === 'finished';
  const winnerLabel = finished
    ? data?.room.winner_player_id === meId ? 'ПОБЕДА' : data?.room.winner_player_id ? 'ПОРАЖЕНИЕ' : 'НИЧЬЯ'
    : '';

  return <div className="duel-room-overlay">
    <div className="duel-room-shell">
      <div className="duel-room-head">
        <div><span>ПРИВАТНАЯ ДУЭЛЬ · {code.slice(0, 6).toUpperCase()}</span><b>{statusText}</b></div>
        <button onClick={onClose} aria-label="Закрыть">×</button>
      </div>

      {error && <div className="duel-room-error">{error}</div>}
      {!data && !error && <div className="duel-room-loading">Проверяем Telegram-сессию и доступ к комнате…</div>}

      {data && <>
        <div className="duel-versus">
          <div className="duel-person"><span>ВЫ</span><b>{me?.name || 'Гонщик'}</b><small>РЕЙТИНГ {me?.rating ?? 0}</small></div>
          <div className="duel-vs-mark">VS</div>
          <div className="duel-person right"><span>СОПЕРНИК</span><b>{other?.name || 'Гонщик'}</b><small>РЕЙТИНГ {other?.rating ?? 0}</small></div>
        </div>

        {!finished && <div className="duel-room-grid">
          <section>
            <div className="duel-room-label">Ваша машина</div>
            <div className="duel-car-picker">
              {data.cars.map((car) => <button key={car.id} disabled={busy || Boolean(myReady) || data.room.status === 'racing'} className={myCarId === car.id ? 'selected' : ''} onClick={() => void act({action:'selectCar',carId:car.id})}>
                <div className="duel-car-image">{car.image_path ? <img src={car.image_path} alt="" /> : <span>{car.name.slice(0,2)}</span>}</div>
                <div><b>{car.name}</b><small>{car.tier} · {car.power} л.с.</small></div>
              </button>)}
            </div>
          </section>

          <section className="duel-opponent-lock">
            <div className="duel-room-label">Выбор соперника</div>
            <div className="duel-locked-car">
              <div className="duel-lock-icon">{otherReady ? 'ГОТОВ' : otherCarId ? 'ВЫБРАНО' : 'ЖДЁМ'}</div>
              <b>{otherCar?.name || (otherCarId ? `CAR #${otherCarId}` : 'Машина не выбрана')}</b>
              <small>{otherCar ? `${otherCar.power} л.с. · ${otherCar.tier}` : 'Обновится автоматически'}</small>
            </div>
          </section>
        </div>}

        {!finished && data.room.status !== 'racing' && <div className="duel-ready-row">
          <div><span>Вы</span><b className={myReady ? 'ready' : ''}>{myReady ? 'ГОТОВ' : myCarId ? 'МАШИНА ВЫБРАНА' : 'ВЫБЕРИТЕ МАШИНУ'}</b></div>
          <div><span>Соперник</span><b className={otherReady ? 'ready' : ''}>{otherReady ? 'ГОТОВ' : 'ОЖИДАНИЕ'}</b></div>
          <button disabled={busy || !myCarId} onClick={() => void act({action:'ready',ready:!myReady})}>{myReady ? 'Отменить готовность' : 'Я ГОТОВ'}</button>
        </div>}

        {data.room.status === 'racing' && <div className="duel-countdown-card">
          {countdown && countdown > 0 ? <><span>СТАРТ ЧЕРЕЗ</span><b>{countdown}</b><small>Приготовьтесь к дуэли</small></> : myResult ? <><span>ВАШ РЕЗУЛЬТАТ ПРИНЯТ</span><b>{(myResult.elapsedMs / 1000).toFixed(3)}</b><small>{otherResult ? 'Соперник финишировал' : 'Ожидаем результат соперника'}</small></> : <><span>ДУЭЛЬ АКТИВНА</span><b>GO</b><small>Финишируйте первым</small></>}
        </div>}

        {finished && <div className={`duel-finish-card ${winnerLabel === 'ПОБЕДА' ? 'win' : winnerLabel === 'ПОРАЖЕНИЕ' ? 'loss' : ''}`}>
          <span>ДУЭЛЬ ЗАВЕРШЕНА</span><b>{winnerLabel}</b>
          <div className="duel-result-grid"><div><small>Вы</small><strong>{myResult ? `${(myResult.elapsedMs/1000).toFixed(3)} c` : 'НЕ ФИНИШИРОВАЛ'}</strong><em>{myResult ? `${Math.round(myResult.topSpeedKmh)} км/ч` : '0'}</em></div><div><small>Соперник</small><strong>{otherResult ? `${(otherResult.elapsedMs/1000).toFixed(3)} c` : 'НЕ ФИНИШИРОВАЛ'}</strong><em>{otherResult ? `${Math.round(otherResult.topSpeedKmh)} км/ч` : '0'}</em></div></div>
          <button onClick={onClose}>Вернуться в игру</button>
        </div>}
      </>}
    </div>
  </div>;
}
