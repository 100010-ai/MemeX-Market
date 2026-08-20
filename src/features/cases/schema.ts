import { z } from 'zod';

export const caseIdSchema = z.enum(['bronze', 'silver', 'gold']);
export const caseContextSchema = z.object({
  owned_cars: z.array(z.number().int().min(1).max(100000)).max(100),
  available_parts: z.array(z.enum(['engine','turbo','gearbox','tires'])).max(4)
});
export const caseRollRequestSchema = z.object({
  caseId: caseIdSchema,
  context: caseContextSchema
});
export const claimCaseSchema = z.object({ rollId: z.string().uuid() });
