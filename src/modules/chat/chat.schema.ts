import { z } from 'zod';

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().min(1, 'Message cannot be empty').max(4096)
});

export const sendKitCardSchema = z.object({
  conversationId: z.string().uuid(),
  jerseyId: z.string().uuid(),
  customPrice: z.number().nonnegative().optional()
});

export const toggleAiSchema = z.object({
  isAiEnabled: z.boolean()
});

export const conversationFilterSchema = z.object({
  status: z.enum(['open', 'needs_reply', 'resolved', 'archived']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(30)
});
