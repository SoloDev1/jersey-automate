import crypto from 'crypto';
import { config } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';

function getKeyBuffer() {
  if (!config.tokenEncryptionKey) {
    throw new Error('TOKEN_ENCRYPTION_KEY environment variable is not defined.');
  }
  const key = Buffer.from(config.tokenEncryptionKey, 'hex');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must resolve to a 32-byte Buffer.');
  }
  return key;
}

/**
 * Encrypts sensitive string data (such as Meta WABA Access Tokens).
 * Output format: iv_hex:authTag_hex:ciphertext_hex
 */
export function encryptToken(plainText) {
  if (typeof plainText !== 'string' || !plainText) {
    throw new Error('plainText must be a non-empty string');
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKeyBuffer(), iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted token.
 * Validates integrity via GCM auth tag.
 */
export function decryptToken(cipherText) {
  if (typeof cipherText !== 'string' || !cipherText) {
    throw new Error('cipherText must be a non-empty string');
  }

  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format. Expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, encryptedData] = parts;
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKeyBuffer(),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
