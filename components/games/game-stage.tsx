"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Gem, Star } from "lucide-react";

export type GameId = "coinflip" | "dice" | "wheel" | "slots" | "hilo" | "roulette" | "plinko";
export type GameVisual = {
  side?: string;
  face?: number;
  sector?: number;
  reels?: number[];
  rank?: number;
  suit?: number;
  roulette?: number;
  color?: "red" | "black" | "green";
  slot?: number;
};
export type GameRound = {
  id: string;
  game: GameId;
  bet: number;
  choice: string | null;
  result: string;
  number: number | null;
  visual: GameVisual | null;
  multiplier: number;
  payout: number;
  balanceAfter: number;
  createdAt: string;
};

export function GameStage({ game, round, rolling }: { game: GameId; round: GameRound | null; rolling: boolean }) {
  return (
    <div className="mxm-game-stage" aria-live="polite">
      {game === "coinflip" ? <CoinStage round={round?.game === "coinflip" ? round : null} rolling={rolling} /> : null}
      {game === "dice" ? <DiceStage round={round?.game === "dice" ? round : null} rolling={rolling} /> : null}
      {game === "wheel" ? <WheelStage round={round?.game === "wheel" ? round : null} rolling={rolling} /> : null}
      {game === "slots" ? <SlotsStage round={round?.game === "slots" ? round : null} rolling={rolling} /> : null}
      {game === "hilo" ? <CardStage round={round?.game === "hilo" ? round : null} rolling={rolling} /> : null}
      {game === "roulette" ? <RouletteStage round={round?.game === "roulette" ? round : null} rolling={rolling} /> : null}
      {game === "plinko" ? <PlinkoStage round={round?.game === "plinko" ? round : null} rolling={rolling} /> : null}
    </div>
  );
}

function CoinStage({ round, rolling }: { round: GameRound | null; rolling: boolean }) {
  const side = round?.visual?.side || round?.result || "heads";
  const turns = round ? (side === "tails" ? 1980 : 1800) : 0;
  return (
    <div className="mxm-coin-scene">
      <div className={`mxm-coin ${rolling ? "is-rolling" : ""}`} style={!rolling && round ? { transform: `rotateY(${turns}deg)` } : undefined}>
        <div className="mxm-coin-face mxm-coin-heads"><span>MX</span></div>
        <div className="mxm-coin-face mxm-coin-tails"><Gem size={28} fill="currentColor" /></div>
      </div>
      <div className="mxm-game-caption">{rolling ? "…" : side === "tails" ? "Решка" : "Орёл"}</div>
    </div>
  );
}

const diceTransforms: Record<number, string> = {
  1: "rotateX(0deg) rotateY(0deg)",
  2: "rotateY(-90deg)",
  3: "rotateX(90deg)",
  4: "rotateX(-90deg)",
  5: "rotateY(90deg)",
  6: "rotateY(180deg)",
};

function DiceStage({ round, rolling }: { round: GameRound | null; rolling: boolean }) {
  const face = Math.min(6, Math.max(1, Number(round?.visual?.face || round?.number || 1)));
  return (
    <div className="mxm-dice-scene">
      <div className={`mxm-die ${rolling ? "is-rolling" : ""}`} style={!rolling ? { transform: diceTransforms[face] } : undefined}>
        <DieFace n={1} cls="front" /><DieFace n={6} cls="back" /><DieFace n={2} cls="right" />
        <DieFace n={5} cls="left" /><DieFace n={3} cls="top" /><DieFace n={4} cls="bottom" />
      </div>
      <div className="mxm-game-caption">{rolling ? "…" : face}</div>
    </div>
  );
}

function DieFace({ n, cls }: { n: number; cls: string }) {
  return <div className={`mxm-die-face ${cls}`} data-face={n}>{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</div>;
}

const wheelCenters = [90, 225, 297, 338.4, 356.4];
function WheelStage({ round, rolling }: { round: GameRound | null; rolling: boolean }) {
  const rotationRef = useRef(0);
  const [rotation, setRotation] = useState(0);
  const roundId = round?.id;
  useEffect(() => {
    if (!roundId || round?.game !== "wheel") return;
    const sector = Math.min(4, Math.max(0, Number(round.visual?.sector ?? round.number ?? 0)));
    const target = wheelCenters[sector] ?? 90;
    const currentModulo = ((rotationRef.current % 360) + 360) % 360;
    const desiredModulo = ((360 - target) % 360 + 360) % 360;
    const delta = ((desiredModulo - currentModulo + 360) % 360) + 1440;
    rotationRef.current += delta;
    setRotation(rotationRef.current);
  }, [roundId, round]);
  return (
    <div className="mxm-wheel-wrap">
      <div className="mxm-wheel-pointer" />
      <div className={`mxm-wheel ${rolling && !round ? "is-waiting" : ""}`} style={{ transform: `rotate(${rotation}deg)` }}>
        <span className="mxm-wheel-label l0">x0</span>
        <span className="mxm-wheel-label l1">x1.2</span>
        <span className="mxm-wheel-label l2">x1.8</span>
        <span className="mxm-wheel-label l3">x3</span>
        <span className="mxm-wheel-label l4">x8</span>
        <div className="mxm-wheel-hub">MXM</div>
      </div>
      <div className="mxm-game-caption">{rolling ? "Крутим…" : round ? `x${round.multiplier}` : "Колесо"}</div>
    </div>
  );
}

const slotSymbols = ["●", "◆", "★", "✦", "◇"];
function SlotsStage({ round, rolling }: { round: GameRound | null; rolling: boolean }) {
  const reels = useMemo(() => {
    const raw = round?.visual?.reels;
    return [0, 2, 4].map((fallback, index) => Math.min(4, Math.max(0, Number(raw?.[index] ?? fallback))));
  }, [round]);
  return (
    <div className="mxm-slots">
      <div className="mxm-slot-window">
        {reels.map((value, index) => <div key={index} className={`mxm-slot-reel ${rolling ? "is-rolling" : ""}`} style={{ animationDelay: `${index * 70}ms` }}><span>{slotSymbols[value]}</span></div>)}
      </div>
      <div className="mxm-game-caption">{rolling ? "…" : round ? `x${round.multiplier}` : "Комбинация"}</div>
    </div>
  );
}

const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const suits = ["♠", "♥", "♦", "♣"];
function CardStage({ round, rolling }: { round: GameRound | null; rolling: boolean }) {
  const rank = Math.min(13, Math.max(1, Number(round?.visual?.rank || round?.number || 7)));
  const suit = Math.min(3, Math.max(0, Number(round?.visual?.suit || 0)));
  const red = suit === 1 || suit === 2;
  return (
    <div className="mxm-card-scene">
      <div className={`mxm-playing-card ${rolling ? "is-flipping" : ""}`}>
        <span className={red ? "text-[var(--negative)]" : ""}>{ranks[rank - 1]}</span>
        <b className={red ? "text-[var(--negative)]" : ""}>{suits[suit]}</b>
      </div>
      <div className="mxm-game-caption">{rolling ? "…" : rank === 7 ? "7 · мимо" : rank < 7 ? "Ниже 7" : "Выше 7"}</div>
    </div>
  );
}


const rouletteReds = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function RouletteStage({ round, rolling }: { round: GameRound | null; rolling: boolean }) {
  const number = Math.min(36, Math.max(0, Number(round?.visual?.roulette ?? round?.number ?? 0)));
  const color = round?.visual?.color || (number === 0 ? "green" : rouletteReds.has(number) ? "red" : "black");
  const turns = round ? 1260 + ((36 - number) / 37) * 360 : 0;
  return (
    <div className="mxm-roulette-scene">
      <div className={`mxm-roulette-wheel ${rolling ? "is-rolling" : ""}`} style={!rolling && round ? { transform: `rotate(${turns}deg)` } : undefined}>
        <div className="mxm-roulette-track" />
        <div className="mxm-roulette-center"><span className={`is-${color}`}>{rolling ? "•" : number}</span></div>
      </div>
      <div className="mxm-game-caption">{rolling ? "…" : round ? (number === 0 ? "0" : color === "red" ? "Красное" : "Чёрное") : "Рулетка"}</div>
    </div>
  );
}

const plinkoMultipliers = [8, 2.6, 1.3, 0.8, 0.4, 0.8, 1.3, 2.6, 8];
function PlinkoStage({ round, rolling }: { round: GameRound | null; rolling: boolean }) {
  const slot = Math.min(8, Math.max(0, Number(round?.visual?.slot ?? round?.number ?? 4)));
  const offset = (slot - 4) * 21;
  return (
    <div className="mxm-plinko-scene">
      <div className="mxm-plinko-board">
        <div className={`mxm-plinko-ball ${rolling && round ? "is-dropping" : ""}`} style={{ "--plinko-x": `${offset}px` } as React.CSSProperties} />
        <div className="mxm-plinko-pegs">{Array.from({ length: 36 }, (_, index) => <i key={index} />)}</div>
        <div className="mxm-plinko-slots">{plinkoMultipliers.map((value, index) => <span key={index} className={!rolling && round && index === slot ? "is-hit" : ""}>{value}</span>)}</div>
      </div>
      <div className="mxm-game-caption">{rolling ? "Падает…" : round ? `x${round.multiplier}` : "Plinko"}</div>
    </div>
  );
}

export function GameMiniIcon({ game }: { game: GameId }) {
  if (game === "wheel") return <span className="mxm-mini-wheel" />;
  if (game === "dice") return <span className="mxm-mini-die">••</span>;
  if (game === "coinflip") return <span className="mxm-mini-coin">M</span>;
  if (game === "slots") return <span className="mxm-mini-slots"><Star size={11} fill="currentColor" /></span>;
  if (game === "hilo") return <span className="mxm-mini-card">A</span>;
  if (game === "roulette") return <span className="mxm-mini-wheel">0</span>;
  return <span className="mxm-mini-plinko">•</span>;
}
