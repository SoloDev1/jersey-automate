import { z } from 'zod';

export const testChatSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(2000, 'Message is too long'),
  conversationId: z.string().uuid('Invalid conversation UUID').optional()
});
