import { requireAdmin } from '@/features/admin/auth';
import { applyPlayerAdminAction, listAdminPlayers } from '@/features/admin/server';
import { playerAdminActionSchema } from '@/features/admin/schema';
import { apiError, assertSameOrigin, noStoreJson } from '@/lib/security/http';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try { await requireAdmin(); const q = new URL(request.url).searchParams.get('q') ?? ''; return noStoreJson({ ok: true, players: await listAdminPlayers(q) }); }
  catch (error) { return apiError(error, 403); }
}
export async function POST(request: Request) {
  try { assertSameOrigin(request); const admin = await requireAdmin(); const action = playerAdminActionSchema.parse(await request.json()); return noStoreJson({ ok: true, result: await applyPlayerAdminAction(admin, action) }); }
  catch (error) { return apiError(error, 403); }
}
