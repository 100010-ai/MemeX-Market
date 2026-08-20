import { requireAdmin } from '@/features/admin/auth';
import { listCars, upsertCar } from '@/features/admin/server';
import { adminCarSchema } from '@/features/admin/schema';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
export const runtime = 'nodejs';
export async function GET() { try { await requireAdmin(); return noStoreJson({ ok: true, cars: await listCars() }); } catch (error) { return apiError(error, 403); } }
export async function POST(request: Request) { try { assertSameOrigin(request); const admin=await requireAdmin(); const car=adminCarSchema.parse(await request.json()); return noStoreJson({ ok:true, car:await upsertCar(admin,car) }); } catch(error){ return apiError(error,403); } }
