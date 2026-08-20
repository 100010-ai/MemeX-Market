import { requireAdmin } from '@/features/admin/auth';
import { listOpponents, upsertOpponent } from '@/features/admin/server';
import { adminOpponentSchema } from '@/features/admin/schema';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
export const runtime='nodejs';
export async function GET(){try{await requireAdmin();return noStoreJson({ok:true,opponents:await listOpponents()});}catch(error){return apiError(error,403)}}
export async function POST(request:Request){try{assertSameOrigin(request);const admin=await requireAdmin();const opp=adminOpponentSchema.parse(await request.json());return noStoreJson({ok:true,opponent:await upsertOpponent(admin,opp)});}catch(error){return apiError(error,403)}}
