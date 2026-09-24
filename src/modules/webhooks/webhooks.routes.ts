import { Router } from 'express';
import { webhooksController } from './webhooks.controller.js';

export const webhooksRouter = Router();

// Meta WhatsApp Webhook Handshake Verification
webhooksRouter.get('/whatsapp', webhooksController.verifyWebhook);

// Meta WhatsApp Webhook Inbound Events (Messages & Delivery Receipts)
webhooksRouter.post('/whatsapp', webhooksController.receiveWebhook);
