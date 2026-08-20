import { createServerSupabase } from '@/lib/supabase/server';
import type { RaceSubmission } from './schema';
import { plausiblyValidRace } from './schema';

export async function submitRace(playerId: string, race: RaceSubmission) {
  const verified = plausiblyValidRace(race);
  const supabase = createServerSupabase();
  const { data, error } = await supabase.rpc('autosyndicate_record_race_v10', {
    p_player_id: playerId,
    p_race_id: race.raceId,
    p_opponent_id: race.opponentId,
    p_route: race.route,
    p_won: race.won,
    p_elapsed_ms: race.elapsedMs,
    p_top_speed_kmh: race.topSpeedKmh,
    p_perfect_shifts: race.perfectShifts,
    p_good_shifts: race.goodShifts,
    p_missed_shifts: race.missedShifts,
    p_started_in_gear: race.startedInGear,
    p_finish_gear: race.finishGear,
    p_verified: verified
  });
  if (error) throw error;
  return { verified: Boolean(data) };
}
