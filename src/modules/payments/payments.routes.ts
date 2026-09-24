import { Router } from 'express';
import { paymentsController } from './payments.controller.js';
import { validateRequest } from '../../core/middleware/validateRequest.js';
import { initializePaymentSchema } from './payments.schema.js';

export const paymentsRouter = Router();

// 1. Initialize Paystack payment for an order
paymentsRouter.post(
  '/initialize',
  validateRequest({ body: initializePaymentSchema }),
  paymentsController.initialize
);

// 2. Direct payment verification by reference
paymentsRouter.get('/verify/:reference', paymentsController.verify);

// 3. Paystack webhook endpoint (HMAC-SHA512 verified)
paymentsRouter.post('/webhook', paymentsController.handleWebhook);
