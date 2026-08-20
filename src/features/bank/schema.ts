import { z } from 'zod';

export const bankActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('send'),
    receiverId: z.string().regex(/^tg_[0-9]{1,24}$/),
    amount: z.number().int().min(1).max(800)
  }),
  z.object({ action: z.literal('claim') })
]);
