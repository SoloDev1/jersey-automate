import dotenv from 'dotenv';
dotenv.config();

export const config = {
  metaAppId: process.env.META_APP_ID || '',
  metaAppSecret: process.env.META_APP_SECRET || '',
  metaConfigId: process.env.META_CONFIG_ID || '',
  graphApiVersion: process.env.GRAPH_API_VERSION || 'v25.0',
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || '',
  webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'default_verify_token',
  port: parseInt(process.env.PORT || '3000', 10)
};

export function validateConfig() {
  const missing = [];
  if (!config.tokenEncryptionKey) missing.push('TOKEN_ENCRYPTION_KEY');
  
  if (config.tokenEncryptionKey && Buffer.from(config.tokenEncryptionKey, 'hex').length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 32-byte hexadecimal string (64 characters).');
  }

  return {
    valid: missing.length === 0,
    missing
  };
}
