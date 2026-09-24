import { Request, Response } from 'express';
import { webhooksService } from './webhooks.service.js';

export const webhooksController = {
  /**
   * GET /api/v1/webhooks/whatsapp
   * Meta WhatsApp Webhook Handshake Verification Challenge.
   */
  verifyWebhook(req: Request, res: Response): void {
    const mode = req.query['hub.mode'] as string | undefined;
    const token = req.query['hub.verify_token'] as string | undefined;
    const challenge = req.query['hub.challenge'] as string | undefined;

    const result = webhooksService.verifyMetaChallenge(mode, token, challenge);

    if (result.isValid && result.challenge) {
      console.log('[Webhooks] Meta WhatsApp webhook handshake verified successfully');
      res.status(200).send(result.challenge);
      return;
    }

    console.warn('[Webhooks] Meta WhatsApp webhook verification failed (token mismatch)');
    res.status(403).send('Forbidden: Invalid verification token');
  },

  /**
   * POST /api/v1/webhooks/whatsapp
   * Meta WhatsApp Cloud API Inbound Events (Messages & Delivery Receipts).
   * Complies with Meta's strict sub-50ms response time requirement.
   */
  receiveWebhook(req: Request, res: Response): void {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    const isAuthentic = webhooksService.verifyMetaSignature(req.rawBody, signature);
    if (!isAuthentic) {
      console.warn('[Webhooks] Rejected unauthorized Meta webhook (HMAC signature mismatch)');
      res.status(401).send('Unauthorized: Invalid HMAC signature');
      return;
    }

    // Acknowledge Meta immediately with HTTP 200 OK (< 50ms)
    res.status(200).send('EVENT_RECEIVED');

    // Asynchronous background processing of messages and receipts
    webhooksService.processMetaPayload(req.body).catch((error) => {
      console.error('[Webhooks] Error processing background WhatsApp webhook payload:', error);
    });
  }
};
