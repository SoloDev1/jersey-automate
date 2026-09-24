import { z } from 'zod';

export const jerseySizeEnum = z.enum(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);

export const createJerseySchema = z.object({
  title: z.string().min(3).max(255),
  league: z.string().min(2).max(100),
  team: z.string().min(2).max(150),
  season: z.string().min(2).max(50),
  kitType: z.string().min(2).max(100),
  basePrice: z.number().nonnegative(),
  imageUrl: z.string().url(),
  description: z.string().optional(),
  discoveredKitId: z.string().uuid().optional(),
  initialStock: z.record(jerseySizeEnum, z.number().int().nonnegative()).optional()
});

export const updateJerseySchema = z.object({
  title: z.string().min(3).max(255).optional(),
  basePrice: z.number().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional()
});

export const adjustStockSchema = z.object({
  size: jerseySizeEnum,
  quantityDelta: z.number().int().refine((n) => n !== 0, {
    message: 'Quantity delta must be non-zero'
  }),
  reason: z.string().optional().default('Manual inventory adjustment'),
  actor: z.string().optional().default('store_owner')
});

export const catalogFilterSchema = z.object({
  league: z.string().optional(),
  team: z.string().optional(),
  season: z.string().optional(),
  kitType: z.string().optional(),
  size: jerseySizeEnum.optional(),
  inStock: z
    .string()
    .optional()
    .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20)
});
