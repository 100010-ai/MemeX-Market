export const GEAR_SPEED_LIMITS = [0, 40, 90, 150, 215, 285, 380] as const;
export const REDLINE_RPM = 8_400;
export const IDLE_RPM = 900;

export type Gear = 1 | 2 | 3 | 4 | 5 | 6;
export type ShiftQuality = 'miss' | 'good' | 'perfect';

export interface GearboxSetup {
  level: number;
  rpmGain: number;
  goodWindow: readonly [number, number];
  perfectWindow: readonly [number, number];
  missPenalty: number;
}

export function gearboxSetup(level: number): GearboxSetup {
  const safe = Math.max(0, Math.min(5, Math.trunc(level)));
  return {
    level: safe,
    rpmGain: 1 + safe * 0.032,
    goodWindow: [6_650 - safe * 70, 8_180 + safe * 30],
    perfectWindow: [7_360 - safe * 45, 7_820 + safe * 55],
    missPenalty: Math.max(0.55, 0.84 - safe * 0.045)
  };
}

export function speedLimitForGear(gear: Gear) { return GEAR_SPEED_LIMITS[gear]; }

export function rpmForSpeed(speedKmh: number, gear: Gear) {
  const lower = gear === 1 ? 0 : GEAR_SPEED_LIMITS[gear - 1];
  const upper = GEAR_SPEED_LIMITS[gear];
  const progress = Math.max(0, Math.min(1, (speedKmh - lower) / Math.max(1, upper - lower)));
  return Math.round(IDLE_RPM + progress * (REDLINE_RPM - IDLE_RPM));
}

export function classifyShift(rpm: number, gearboxLevel: number): ShiftQuality {
  const setup = gearboxSetup(gearboxLevel);
  if (rpm >= setup.perfectWindow[0] && rpm <= setup.perfectWindow[1]) return 'perfect';
  if (rpm >= setup.goodWindow[0] && rpm <= setup.goodWindow[1]) return 'good';
  return 'miss';
}

export function canLaunch(gear: Gear, speedKmh: number) {
  return gear === 1 || speedKmh > 4;
}

export function enforceGearLimit(speedKmh: number, gear: Gear) {
  return Math.max(0, Math.min(speedKmh, speedLimitForGear(gear)));
}
