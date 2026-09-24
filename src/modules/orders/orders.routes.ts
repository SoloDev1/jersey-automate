import { Router } from 'express';
import { ordersController } from './orders.controller.js';
import { validateRequest } from '../../core/middleware/validateRequest.js';
import {
  createOrderSchema,
  updateOrderStatusSchema,
  orderFilterSchema
} from './orders.schema.js';

export const ordersRouter = Router();

// 1. List orders with filters & pagination
ordersRouter.get(
  '/',
  validateRequest({ query: orderFilterSchema }),
  ordersController.list
);

// 2. Get single order by ID
ordersRouter.get('/:id', ordersController.getById);

// 3. Create a new order with atomic 15-minute stock hold
ordersRouter.post(
  '/',
  validateRequest({ body: createOrderSchema }),
  ordersController.create
);

// 4. Update fulfillment status or tracking number
ordersRouter.patch(
  '/:id/status',
  validateRequest({ body: updateOrderStatusSchema }),
  ordersController.updateStatus
);
