import { requireAdmin } from '@/features/admin/auth';
import { getAdminStats } from '@/features/admin/server';
import { apiError, noStoreJson } from '@/lib/security/http';
export const runtime = 'nodejs';
export async function GET() { try { await requireAdmin(); return noStoreJson({ ok: true, stats: await getAdminStats() }); } catch (error) { return apiError(error, 403); } }
