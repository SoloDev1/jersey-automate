import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, validateConfig } from './config/env.js';
import { requireTenantAuth } from './middleware/auth.js';
import { onboardingController } from './controllers/onboardingController.js';
import { webhookController } from './controllers/webhookController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validate critical configuration on startup
const validation = validateConfig();
if (!validation.valid) {
  console.warn('[Config Warning] Missing required environment variables:', validation.missing);
}

const app = express();

// Enable Cross-Origin Resource Sharing
app.use(cors());

// IMPORTANT: Capture rawBody buffer for HMAC SHA-256 Webhook Verification
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, '../public')));

// Public Client Configuration (Safe parameters for Meta JS SDK)
app.get('/api/config', (req, res) => {
  res.json({
    appId: config.metaAppId,
    configId: config.metaConfigId,
    graphApiVersion: config.graphApiVersion
  });
});

// Authenticated Onboarding & Connection Routes
app.post('/api/whatsapp/onboard', requireTenantAuth, onboardingController.onboard);
app.get('/api/whatsapp/status', requireTenantAuth, onboardingController.getConnectionStatus);
app.post('/api/whatsapp/disconnect', requireTenantAuth, onboardingController.disconnect);

// WhatsApp Webhook Handshake & Ingestion
app.get('/api/webhooks/whatsapp', webhookController.handleChallenge);
app.post('/api/webhooks/whatsapp', webhookController.verifySignature, webhookController.handleWebhook);
app.get('/api/webhooks/events', webhookController.getRecentEvents);

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export function startServer(port = config.port) {
  return app.listen(port, () => {
    console.log(`====================================================`);
    console.log(` Jersey Automate - WhatsApp Onboarding Service`);
    console.log(` Running on: http://localhost:${port}`);
    console.log(` Webhook URL: http://localhost:${port}/api/webhooks/whatsapp`);
    console.log(`====================================================`);
  });
}

// Start listener automatically if run directly
let server = null;
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('server.js') || 
  process.argv[1].includes('server')
);

if (isDirectRun && process.env.NODE_ENV !== 'test') {
  server = startServer(config.port);
}

export { app, server };

