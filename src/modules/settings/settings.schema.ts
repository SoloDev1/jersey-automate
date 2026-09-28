import { z } from 'zod';

export const updateStoreSettingsSchema = z.object({
  storeName: z.string().min(1).max(255).optional(),
  storeCategory: z.string().min(1).max(50).optional(),
  businessDescription: z.string().max(2000).optional(),
  storeEmoji: z.string().min(1).max(10).optional(),
  currency: z.string().min(1).max(10).optional(),
  defaultShippingFee: z.number().min(0).optional(),
  customPrintingFee: z.number().min(0).optional(),
  customOptionTitle: z.string().max(100).optional(),
  customOptionFee: z.number().min(0).optional(),
  aiPersonaTone: z.string().min(1).max(50).optional(),
  customStorePolicies: z.string().max(3000).optional(),
  outOfScopeMessage: z.string().max(1000).optional(),
  clarificationMessage: z.string().max(1000).optional(),
  brandKeywords: z.array(z.string().min(1).max(50)).max(100).optional(),
  categoryKeywords: z.array(z.string().min(1).max(50)).max(100).optional(),
  aiEnabledGlobally: z.boolean().optional(),
  maxMonthlyAiBudgetUsd: z.number().min(0).max(5000).optional()
});

export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>;
