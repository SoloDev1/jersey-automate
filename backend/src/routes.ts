import { Router } from 'express';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';
import { paymentsRouter } from './modules/payments/payments.routes.js';
import { chatRouter } from './modules/chat/chat.routes.js';
import { whatsappRouter } from './modules/whatsapp/whatsapp.routes.js';
import { webhooksRouter } from './modules/webhooks/webhooks.routes.js';
import { aiRouter } from './modules/ai/ai.routes.js';
import { customersRouter } from './modules/customers/customers.routes.js';

export const apiRouter = Router();

// Base API health check
apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    organizationId: req.organizationId,
    timestamp: new Date().toISOString()
  });
});

// Domain Modules
apiRouter.use('/catalog', catalogRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/payments', paymentsRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/customers', customersRouter);
apiRouter.use('/whatsapp', whatsappRouter);
apiRouter.use('/webhooks', webhooksRouter);
apiRouter.use('/ai', aiRouter);



