"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, CircleDollarSign } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { money } from "@/lib/format";
import { PrimaryButton } from "@/components/ui";
import { useTelegramProfile } from "@/components/telegram-provider";
import { GameMiniIcon, GameStage, type GameId, type GameRound, type GameVisual } from "@/components/games/game-stage";

const games: Array<{ id: GameId; title: string; tag: string }> = [
  { id: "coinflip", title: "Монета", tag: "x1.92" },
  { id: "dice", title: "Кубик", tag: "x1.92" },
  { id: "wheel", title: "Колесо", tag: "до x8" },
  { id: "slots", title: "Слоты", tag: "до x10" },
  { id: "hilo", title: "Карты", tag: "x2.05" },
  { id: "roulette", title: "Рулетка", tag: "x1.92" },
  { id: "plinko", title: "Plinko", tag: "до x8" },
];

type Payload = { balance: number; availableBalance: number; reservedBalance: number; rounds: GameRound[] };
type PlayResponse = { round: { id: string; game: GameId; bet: number | string; choice: string | null; result: string; number: number | null; visual?: GameVisual | null; multiplier: number | string; payout: number | string; balance: number | string } };


function makePlayKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `game:${crypto.randomUUID()}`;
  return `game:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function defaultChoice(game: GameId) {
  if (game === "coinflip") return "heads";
  if (game === "dice" || game === "hilo") return "low";
  if (game === "roulette") return "red";
  return "";
}

export default function GamesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [game, setGame] = useState<GameId>("coinflip");
  const [bet, setBet] = useState("1");
  const [choice, setChoice] = useState("heads");
  const [requesting, setRequesting] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [last, setLast] = useState<GameRound | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSettlement = useRef<GameRound | null>(null);
  const { refreshProfile, patchProfile, haptic } = useTelegramProfile();
  const refreshProfileRef = useRef(refreshProfile);
  useEffect(() => { refreshProfileRef.current = refreshProfile; }, [refreshProfile]);

  const load = useCallback(async () => {
    try {
      const payload = await apiFetch<Payload>("/api/games", { cacheMs: 5_000 });
      setData(payload);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Игры недоступны");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    if (pendingSettlement.current) void refreshProfileRef.current();
    pendingSettlement.current = null;
  }, []);

  function selectGame(next: GameId) {
    if (requesting || revealing || next === game) return;
    setGame(next);
    setChoice(defaultChoice(next));
    setLast(null);
    setError(null);
    haptic("light");
  }

  const amount = Number(bet);
  const locked = requesting || revealing;
  const maxBet = Math.min(100, data?.availableBalance || 0);
  const canPlay = Boolean(data && Number.isFinite(amount) && amount >= 0.1 && amount <= maxBet && !locked);

  async function play() {
    if (!canPlay) return;
    setRequesting(true);
    setError(null);
    setLast(null);
    haptic("medium");
    try {
      const result = await apiFetch<PlayResponse>("/api/games/play", {
        method: "POST",
        body: JSON.stringify({ game, bet: amount, choice: game === "wheel" || game === "slots" || game === "plinko" ? null : choice, requestKey: makePlayKey() }),
        timeoutMs: 15_000,
      });
      const row: GameRound = {
        id: String(result.round.id),
        game: result.round.game,
        bet: Number(result.round.bet),
        choice: result.round.choice ?? null,
        result: String(result.round.result),
        number: result.round.number == null ? null : Number(result.round.number),
        visual: result.round.visual || null,
        multiplier: Number(result.round.multiplier),
        payout: Number(result.round.payout),
        balanceAfter: Number(result.round.balance),
        createdAt: new Date().toISOString(),
      };
      setLast(row);
      setRequesting(false);
      setRevealing(true);
      pendingSettlement.current = row;
      revealTimer.current = setTimeout(() => {
        setData((current) => current ? {
          ...current,
          balance: row.balanceAfter,
          availableBalance: Math.max(0, row.balanceAfter - current.reservedBalance),
          rounds: [row, ...current.rounds].slice(0, 12),
        } : current);
        patchProfile({ balance: row.balanceAfter, availableBalance: Math.max(0, row.balanceAfter - (data?.reservedBalance || 0)) });
        pendingSettlement.current = null;
        setRevealing(false);
        haptic(row.payout > row.bet ? "light" : "medium");
        void refreshProfile();
      }, game === "wheel" ? 2400 : game === "plinko" ? 1450 : game === "roulette" ? 1250 : 900);
    } catch (cause) {
      setRequesting(false);
      setError(cause instanceof Error ? cause.message : "Раунд не выполнен");
    }
  }

  const recent = useMemo(() => data?.rounds || [], [data]);
  const activeRound = last?.game === game ? last : null;
  const rolling = requesting || revealing;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h1 className="text-sm font-semibold">Игры</h1>
        <div className="flex items-center gap-1 text-xs font-semibold"><CircleDollarSign size={13} className="text-[var(--accent)]" />{data ? money(data.availableBalance) : "—"}</div>
      </div>

      <div className="mxm-game-picker mb-3">
        {games.map((item) => <button key={item.id} onClick={() => selectGame(item.id)} className={`mxm-game-card ${game === item.id ? "is-active" : ""}`}>
          <GameMiniIcon game={item.id} />
          <span className="min-w-0"><b>{item.title}</b><small>{item.tag}</small></span>
          {game === item.id ? <ChevronRight size={13} className="ml-auto text-[var(--accent)]" /> : null}
        </button>)}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_250px]">
        <section className="mxm-game-panel">
          <GameStage game={game} round={activeRound} rolling={rolling} />

          <div className="mxm-game-controls">
            <div className="flex items-end gap-2">
              <label className="min-w-0 flex-1"><span className="mxm-field-label">Ставка</span><div className="mxm-bet-input"><input value={bet} onChange={(event) => setBet(event.target.value)} inputMode="decimal" disabled={locked} /><span>TON</span></div></label>
              <button type="button" disabled={locked || !data} onClick={() => setBet(String(Math.max(0.1, Math.min(maxBet, maxBet / 2))))} className="mxm-compact-action">½</button>
              <button type="button" disabled={locked || !data} onClick={() => setBet(String(maxBet))} className="mxm-compact-action">MAX</button>
            </div>
            <div className="mxm-quick-bets">{[1, 5, 10, 25, 50, 100].map((value) => <button key={value} disabled={locked || value > maxBet} onClick={() => setBet(String(value))}>{value}</button>)}</div>

            {game === "coinflip" ? <ChoiceRow value={choice} onChange={setChoice} options={[{ value: "heads", label: "Орёл" }, { value: "tails", label: "Решка" }]} /> : null}
            {game === "dice" ? <ChoiceRow value={choice} onChange={setChoice} options={[{ value: "low", label: "1–3" }, { value: "high", label: "4–6" }]} /> : null}
            {game === "hilo" ? <ChoiceRow value={choice} onChange={setChoice} options={[{ value: "low", label: "Ниже 7" }, { value: "high", label: "Выше 7" }]} /> : null}
            {game === "roulette" ? <ChoiceRow value={choice} onChange={setChoice} options={[{ value: "red", label: "Красное" }, { value: "black", label: "Чёрное" }]} /> : null}
            {game === "wheel" ? <div className="mxm-odds-row"><Odds value="x0" chance="50%" /><Odds value="x1.2" chance="25%" /><Odds value="x1.8" chance="15%" /><Odds value="x3" chance="8%" /><Odds value="x8" chance="2%" /></div> : null}
            {game === "slots" ? <div className="mxm-odds-row"><Odds value="пара" chance="x1.5" /><Odds value="три" chance="x5" /><Odds value="◇◇◇" chance="x10" /></div> : null}
            {game === "plinko" ? <div className="mxm-odds-row"><Odds value="края" chance="x8" /><Odds value="2/6" chance="x1.3" /><Odds value="центр" chance="x0.4" /></div> : null}

            {activeRound && !requesting && !revealing ? <div className={`mxm-round-result ${activeRound.payout > activeRound.bet ? "is-win" : ""}`}><b>{roundNet(activeRound)}</b><span>{activeRound.multiplier > 0 ? `x${activeRound.multiplier}` : resultLabel(activeRound)}</span></div> : null}
            {error ? <div className="mxm-inline-error">{error}</div> : null}
            <PrimaryButton onClick={play} disabled={!canPlay} className="mt-2.5 w-full !rounded-[15px] !py-2.5 !text-xs">{requesting ? "Считаем…" : revealing ? "Результат…" : "Играть"}</PrimaryButton>
          </div>
        </section>

        <aside className="mxm-game-history">
          <div className="mxm-history-title">Раунды</div>
          {recent.length ? <div className="divide-y divide-[var(--border-soft)]">{recent.slice(0, 10).map((round) => <div key={round.id} className="mxm-history-row"><div><b>{gameTitle(round.game)}</b><span>{money(round.bet)} · {resultLabel(round)}</span></div><strong className={round.payout > round.bet ? "is-win" : ""}>{round.multiplier > 0 ? `x${round.multiplier}` : "—"}</strong></div>)}</div> : <div className="mxm-history-empty">Пусто</div>}
        </aside>
      </div>
    </div>
  );
}

function ChoiceRow({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <div className="mxm-choice-row">{options.map((option) => <button key={option.value} onClick={() => onChange(option.value)} className={value === option.value ? "is-active" : ""}>{option.label}</button>)}</div>;
}
function Odds({ value, chance }: { value: string; chance: string }) { return <span><b>{value}</b><small>{chance}</small></span>; }
function gameTitle(game: GameId) { return game === "coinflip" ? "Монета" : game === "dice" ? "Кубик" : game === "wheel" ? "Колесо" : game === "slots" ? "Слоты" : game === "hilo" ? "Карты" : game === "roulette" ? "Рулетка" : "Plinko"; }
function roundNet(round: GameRound) {
  const net = round.payout - round.bet;
  if (Math.abs(net) < 1e-9) return "0";
  return `${net > 0 ? "+" : "−"}${money(Math.abs(net))}`;
}
function resultLabel(round: GameRound) {
  if (round.game === "coinflip") return round.result === "heads" ? "Орёл" : "Решка";
  if (round.game === "wheel") return `x${round.multiplier}`;
  if (round.game === "slots") return round.multiplier > 0 ? `x${round.multiplier}` : "Мимо";
  if (round.game === "hilo") return round.number === 7 ? "7" : String(round.number ?? round.result);
  if (round.game === "roulette") return String(round.number ?? round.result);
  if (round.game === "plinko") return `x${round.multiplier}`;
  return String(round.number ?? round.result);
}
