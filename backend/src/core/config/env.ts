import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Supabase (PostgreSQL & Storage)
  SUPABASE_URL: z.string().url().default('https://placeholder-project.supabase.co'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default('placeholder-service-role-key'),
  
  // Paystack
  PAYSTACK_SECRET_KEY: z.string().default('sk_test_placeholder'),
  PAYSTACK_PUBLIC_KEY: z.string().default('pk_test_placeholder'),

  // OpenAI (GPT-4o-mini / Pluggable AI)
  OPENAI_API_KEY: z.string().default('placeholder-openai-key'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // Meta WhatsApp Cloud API
  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  META_CONFIG_ID: z.string().default(''),
  GRAPH_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().default('jersey_automate_verify_token'),
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
  if (env.SUPABASE_URL.includes('placeholder')) missing.push('SUPABASE_URL');
  if (env.SUPABASE_SERVICE_ROLE_KEY.includes('placeholder')) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (env.PAYSTACK_SECRET_KEY.includes('placeholder')) missing.push('PAYSTACK_SECRET_KEY');
  if (env.OPENAI_API_KEY.includes('placeholder')) missing.push('OPENAI_API_KEY');
  return {
    isConfigured: missing.length === 0,
    missing
  };
}
