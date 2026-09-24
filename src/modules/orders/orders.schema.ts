import { z } from 'zod';
import { jerseySizeEnum } from '../catalog/catalog.schema.js';

export const paymentStatusEnum = z.enum(['pending', 'paid', 'failed', 'refunded']);
export const fulfillmentStatusEnum = z.enum(['unfulfilled', 'printing', 'shipped', 'delivered', 'cancelled']);

export const orderItemInputSchema = z.object({
  jerseyId: z.string().uuid(),
  size: jerseySizeEnum,
  quantity: z.number().int().positive().default(1),
  customName: z.string().max(100).optional(),
  customNumber: z.string().max(10).optional()
});

export const createOrderSchema = z.object({
  customerPhone: z.string().min(8).max(50),
  customerName: z.string().max(150).optional(),
  items: z.array(orderItemInputSchema).min(1, 'Order must contain at least one item'),
  shippingAddress: z.string().optional(),
  notes: z.string().optional()
});

export const updateOrderStatusSchema = z.object({
  fulfillmentStatus: fulfillmentStatusEnum.optional(),
  shippingTrackingNumber: z.string().max(100).optional(),
  notes: z.string().optional()
});

export const orderFilterSchema = z.object({
  paymentStatus: paymentStatusEnum.optional(),
  fulfillmentStatus: fulfillmentStatusEnum.optional(),
  customerPhone: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20)
});
