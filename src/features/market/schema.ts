import { z } from 'zod';

const upgradeSchema = z.object({
  engine: z.number().int().min(0).max(5),
  turbo: z.number().int().min(0).max(5),
  gearbox: z.number().int().min(0).max(5),
  tires: z.number().int().min(0).max(5)
});

export const vehicleDataSchema = z.object({
  carId: z.number().int().min(1).max(100000),
  upgrades: upgradeSchema,
  fuel: z.number().min(0).max(100),
  condition: z.number().min(0).max(100),
  plate: z.object({
    uid: z.string().max(64).optional(),
    text: z.string().min(1).max(18),
    rarity: z.string().min(1).max(24),
    series: z.string().max(24).optional(),
    value: z.number().int().min(0).max(2_000_000).optional(),
    limited: z.boolean().optional()
  }).nullable().optional(),
  tuningHistory: z.array(z.record(z.string(), z.unknown())).max(30).optional(),
  effectivePower: z.number().int().min(0).max(10000).optional(),
  tuningValue: z.number().int().min(0).max(50_000_000).optional(),
  buildRating: z.number().int().min(0).max(100).optional(),
  version: z.number().int().min(1).max(10).optional()
}).strict();

export const marketActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('list'),
    price: z.number().int().min(1).max(2_000_000),
    vehicle: vehicleDataSchema
  }),
  z.object({ action: z.literal('cancel'), listingId: z.number().int().positive() }),
  z.object({ action: z.literal('buy'), listingId: z.number().int().positive() }),
  z.object({ action: z.literal('settle'), listingId: z.number().int().positive() })
]);
