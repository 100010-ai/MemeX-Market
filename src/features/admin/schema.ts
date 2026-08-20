import { z } from 'zod';

export const playerAdminActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setBalance'), playerId: z.string().regex(/^tg_\d{1,24}$/), balance: z.number().int().min(0).max(1_000_000_000_000) }),
  z.object({ action: z.literal('addBalance'), playerId: z.string().regex(/^tg_\d{1,24}$/), amount: z.number().int().min(-1_000_000_000).max(1_000_000_000) }),
  z.object({ action: z.literal('ban'), playerId: z.string().regex(/^tg_\d{1,24}$/), reason: z.string().trim().min(1).max(240) }),
  z.object({ action: z.literal('unban'), playerId: z.string().regex(/^tg_\d{1,24}$/) }),
  z.object({ action: z.literal('grantCar'), playerId: z.string().regex(/^tg_\d{1,24}$/), carId: z.number().int().min(1).max(100000) })
]);

export const adminCarSchema = z.object({
  id: z.number().int().min(1).max(100000),
  name: z.string().trim().min(2).max(80),
  imagePath: z.string().trim().max(240).nullable().optional(),
  price: z.number().int().min(0).max(1_000_000_000),
  power: z.number().int().min(30).max(5000),
  tier: z.string().trim().min(1).max(60),
  category: z.string().trim().min(1).max(32),
  flavor: z.string().trim().max(500).default(''),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100000).default(0)
});

export const adminOpponentSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_-]{1,48}$/),
  name: z.string().trim().min(2).max(80),
  power: z.number().int().min(30).max(5000),
  reward: z.number().int().min(0).max(1_000_000_000),
  unlockLevel: z.number().int().min(1).max(500),
  carName: z.string().trim().min(1).max(80),
  rating: z.number().int().min(1).max(100),
  style: z.string().trim().min(1).max(80),
  favoriteTracks: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
  wins: z.number().int().min(0).max(2_000_000_000),
  losses: z.number().int().min(0).max(2_000_000_000),
  avatar: z.string().trim().min(1).max(8),
  taunt: z.string().trim().max(220),
  preLines: z.array(z.string().trim().max(220)).max(8),
  winLine: z.string().trim().max(220),
  loseLine: z.string().trim().max(220),
  boss: z.boolean().default(false),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100000).default(0)
});

export const botCommandSchema = z.object({
  command: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,32}$/),
  responseText: z.string().trim().min(1).max(3500),
  enabled: z.boolean().default(true),
  parseMode: z.enum(['HTML', 'MarkdownV2', 'plain']).default('HTML'),
  buttonLabel: z.string().trim().max(64).nullable().optional(),
  buttonUrl: z.string().url().max(500).nullable().optional()
});

export const gameSettingSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_.-]{2,80}$/),
  value: z.unknown()
});
