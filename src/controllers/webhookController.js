import crypto from 'crypto';
import { config } from '../config/env.js';
import { db } from '../db/storage.js';

export const webhookController = {
  /**
   * Meta Webhook Handshake (GET).
   * Verifies endpoint authenticity during configuration in Meta App Dashboard.
   */
  handleChallenge(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.webhookVerifyToken) {
      console.log('[Webhook] Verification challenge accepted.');
      return res.status(200).send(challenge);
    }

    console.warn('[Webhook] Verification token mismatch or missing.');
    return res.status(403).send('Forbidden');
  },

  /**
   * Express Middleware: HMAC SHA-256 Signature Verification.
   * Compares the X-Hub-Signature-256 header against the HMAC computed over req.rawBody.
   */
  verifySignature(req, res, next) {
    // If running in development without META_APP_SECRET, warn but allow local testing if specified
    if (!config.metaAppSecret && process.env.NODE_ENV !== 'production') {
      console.warn('[Webhook Signature] META_APP_SECRET is not configured; skipping HMAC verification in dev mode.');
      return next();
    }

    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
      console.warn('[Webhook Signature] Missing X-Hub-Signature-256 header.');
      return res.status(401).json({ error: 'Missing signature header' });
    }

    if (!req.rawBody) {
      console.error('[Webhook Signature] req.rawBody is missing. Ensure express.json({ verify }) middleware is configured.');
      return res.status(500).json({ error: 'Server misconfiguration: raw body unavailable' });
    }

    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', config.metaAppSecret)
      .update(req.rawBody)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      console.warn('[Webhook Signature] Invalid signature mismatch.');
      return res.status(401).json({ error: 'Invalid HMAC signature' });
    }

    next();
  },

  /**
   * Webhook Intake (POST).
   * Returns 200 OK immediately and offloads payload persistence asynchronously.
   */
  async handleWebhook(req, res) {
    // 1. Respond immediately to satisfy Meta's 5-second timeout window
    res.status(200).json({ received: true });

    const payload = req.body;
    if (!payload || payload.object !== 'whatsapp_business_account') {
      return;
    }

    try {
      for (const entry of payload.entry || []) {
        const wabaId = entry.id;
        const fieldName = entry.changes?.[0]?.field || 'account_update';

        // Persist to normalized event store
        await db.createWebhookEvent({
          wabaId,
          eventType: fieldName,
          payload: entry
        });

        console.log(`[Webhook Ingestion] Stored event: "${fieldName}" for WABA: ${wabaId}`);
      }
    } catch (err) {
      console.error('[Webhook Ingestion Error]', err);
    }
  },

  /**
   * Diagnostic endpoint to view recent received webhook events.
   */
  async getRecentEvents(req, res) {
    const events = await db.listWebhookEvents(20);
    return res.json({ events });
  }
};
