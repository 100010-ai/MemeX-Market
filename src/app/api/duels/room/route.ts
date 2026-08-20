import { duelCodeSchema, duelRoomActionSchema } from '@/features/duels/schema';
import { getDuelRoomForSession, updateDuelRoom } from '@/features/duels/server';
import { requireSession } from '@/lib/security/session';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
import { enforceRateLimit } from '@/lib/security/rate-limit';
export const runtime='nodejs';
export async function GET(request:Request){try{const session=await requireSession();const code=duelCodeSchema.parse(new URL(request.url).searchParams.get('code'));await enforceRateLimit(session.playerId,'duel-room-read',120,60);return noStoreJson({ok:true,...await getDuelRoomForSession(session,code)});}catch(error){return apiError(error,403)}}
export async function POST(request:Request){try{assertSameOrigin(request);const session=await requireSession();await enforceRateLimit(session.playerId,'duel-room-write',40,60);const action=duelRoomActionSchema.parse(await request.json());return noStoreJson({ok:true,...await updateDuelRoom(session,action)});}catch(error){return apiError(error,403)}}
