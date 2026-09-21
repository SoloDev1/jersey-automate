import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tenantContextMiddleware } from './core/middleware/tenantContext.js';
import { errorHandler } from './core/middleware/errorHandler.js';
import { apiRouter } from './routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

// Disable technology disclosure header
app.disable('x-powered-by');

// Security Response Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Cross-Origin Resource Sharing
app.use(
  cors({
    origin: process.env.NODE_ENV === 'production' && process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',').map((u) => u.trim())
      : '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-organization-id', 'x-paystack-signature', 'x-hub-signature-256']
  })
);

// Raw Body capture with 1MB payload limit for Webhook HMAC Signature verification
app.use(
  express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Tenant Context Middleware (Multi-tenant foundation)
app.use(tenantContextMiddleware);

// Serve static public assets (Meta compliance: privacy.html, data-deletion.html)
app.use(express.static(path.join(__dirname, '../public')));

// Root Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount Versioned API Routes
app.use('/api/v1', apiRouter);

// Centralized Error Handling
app.use(errorHandler);
