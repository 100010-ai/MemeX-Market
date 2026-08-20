import { z } from 'zod';
export const clanActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().trim().min(3).max(24).regex(/^[A-Za-zА-Яа-яЁё0-9 _.-]+$/) }),
  z.object({ action: z.literal('invite'), query: z.string().trim().min(1).max(90) }),
  z.object({ action: z.literal('accept'), inviteId: z.number().int().positive() }),
  z.object({ action: z.literal('leave') }),
  z.object({ action: z.literal('kick'), memberUid: z.string().uuid() })
]);
