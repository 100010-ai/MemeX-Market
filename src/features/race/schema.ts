import { z } from 'zod';

export const raceSubmissionSchema = z.object({
  raceId: z.string().uuid(),
  opponentId: z.string().min(1).max(80),
  route: z.string().min(1).max(64),
  won: z.boolean(),
  elapsedMs: z.number().int().min(2_000).max(180_000),
  topSpeedKmh: z.number().min(0).max(380.5),
  perfectShifts: z.number().int().min(0).max(5),
  goodShifts: z.number().int().min(0).max(5),
  missedShifts: z.number().int().min(0).max(10),
  startedInGear: z.number().int().min(1).max(6),
  finishGear: z.number().int().min(1).max(6)
});

export type RaceSubmission = z.infer<typeof raceSubmissionSchema>;

export function plausiblyValidRace(race: RaceSubmission) {
  if (race.startedInGear !== 1) return false;
  if (race.perfectShifts + race.goodShifts + race.missedShifts > 12) return false;
  if (race.topSpeedKmh > 380.5) return false;
  return true;
}
