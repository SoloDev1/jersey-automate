import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Neon PostgreSQL Database
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),
  
  // Neon Object Storage (S3-Compatible Storage)
  AWS_ENDPOINT_URL_S3: z.string().url(),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().default('eu-central-1'),
  AWS_S3_BUCKET: z.string().default('jerseys'),
  
  // Paystack
  PAYSTACK_SECRET_KEY: z.string().default(''),
  PAYSTACK_PUBLIC_KEY: z.string().default(''),

  // OpenAI (Configurable Dual-Tier AI)
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL_FAST: z.string().default('gpt-4o-mini'),
  OPENAI_MODEL_SMART: z.string().default('gpt-4o'),

  // Meta WhatsApp Cloud API
  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  META_CONFIG_ID: z.string().default(''),
  GRAPH_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().default('jersey_automate_verify_token'),
  WHATSAPP_ACCESS_TOKEN: z.string().default('').or(z.undefined()).transform(val => val || process.env.AccessToken || process.env.META_SYSTEM_USER_TOKEN || ''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().default('').or(z.undefined()).transform(val => val || process.env.DEFAULT_WABA_ID || ''),
  META_SYSTEM_USER_TOKEN: z.string().default(''),
  DEFAULT_WABA_ID: z.string().default(''),

  // Encryption Key (32-byte hex for AES-256-GCM token storage)
  TOKEN_ENCRYPTION_KEY: z.string().default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[Config Error] Invalid environment configuration:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;

/**
 * Checks whether live external credentials have been configured.
 */
export function validateProductionCredentials() {
  const missing: string[] = [];
  if (!env.DATABASE_URL || env.DATABASE_URL.includes('placeholder')) missing.push('DATABASE_URL');
  if (!env.AWS_ENDPOINT_URL_S3 || env.AWS_ENDPOINT_URL_S3.includes('placeholder')) missing.push('AWS_ENDPOINT_URL_S3');
  if (!env.AWS_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID.includes('placeholder')) missing.push('AWS_ACCESS_KEY_ID');
  if (!env.AWS_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY.includes('placeholder')) missing.push('AWS_SECRET_ACCESS_KEY');
  if (!env.PAYSTACK_SECRET_KEY || env.PAYSTACK_SECRET_KEY.includes('placeholder')) missing.push('PAYSTACK_SECRET_KEY');
  if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY.includes('placeholder')) missing.push('OPENAI_API_KEY');
  return {
    isConfigured: missing.length === 0,
    missing
  };
}
