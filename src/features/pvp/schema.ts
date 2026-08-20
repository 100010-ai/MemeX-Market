import { z } from 'zod';

export const pvpActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), power: z.number().int().min(50).max(10_000), stake: z.number().int().min(1).max(25_000) }),
  z.object({ action: z.literal('cancel'), id: z.number().int().positive() }),
  z.object({ action: z.literal('accept'), id: z.number().int().positive() }),
  z.object({ action: z.literal('resolve'), id: z.number().int().positive(), winnerId: z.string().regex(/^tg_[0-9]{1,24}$/) }),
  z.object({ action: z.literal('settle'), id: z.number().int().positive() })
]);
