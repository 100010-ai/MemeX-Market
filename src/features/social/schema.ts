import { z } from 'zod';
export const playerQuerySchema = z.string().trim().min(1).max(90).transform((v: string) => v.replace(/^@/, ''));
export const friendshipActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), query: playerQuerySchema }),
  z.object({ action: z.literal('accept'), friendshipId: z.number().int().positive() }),
  z.object({ action: z.literal('remove'), friendshipId: z.number().int().positive() })
]);
