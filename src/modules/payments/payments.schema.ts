import { z } from 'zod';

export const initializePaymentSchema = z.object({
  orderId: z.string().uuid(),
  email: z.string().email('A valid email address is required for Paystack receipt')
});
