import { requireAdmin } from '@/features/admin/auth';
import { listGameSettings, upsertGameSetting } from '@/features/admin/server';
import { gameSettingSchema } from '@/features/admin/schema';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
export const runtime='nodejs';
export async function GET(){try{await requireAdmin();return noStoreJson({ok:true,settings:await listGameSettings()});}catch(error){return apiError(error,403)}}
export async function POST(request:Request){try{assertSameOrigin(request);const admin=await requireAdmin();const setting=gameSettingSchema.parse(await request.json());return noStoreJson({ok:true,setting:await upsertGameSetting(admin,setting)});}catch(error){return apiError(error,403)}}
