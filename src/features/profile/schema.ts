import { z } from 'zod';

export const profileSyncSchema = z.object({
  displayName: z.string().trim().min(1).max(48),
  photoUrl: z.string().url().max(800).nullable().optional(),
  currentCarName: z.string().trim().max(80).nullable().optional(),
  activeCarId: z.number().int().min(1).max(100000).optional()
}).strict();
