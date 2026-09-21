import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex');
  if (key.length !== 32) {
    throw new Error(
      `[Crypto Error] TOKEN_ENCRYPTION_KEY must be a 32-byte hex string (64 characters). Received ${key.length} bytes.`
    );
  }
  return key;
}

/**
 * Encrypts sensitive string data using AES-256-GCM.
 */
export function encryptToken(text: string): string {
  if (!text) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  // Format: iv:encrypted:tag
  return `${iv.toString('hex')}:${encrypted}:${tag}`;
}

/**
 * Decrypts data encrypted with AES-256-GCM.
 * Safely catches auth tag failures (tampered or corrupted data).
 */
export function decryptToken(payload: string): string {
  if (!payload || !payload.includes(':')) return '';
  const parts = payload.split(':');
  if (parts.length !== 3) return '';

  try {
    const [ivHex, encryptedHex, tagHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');

    if (iv.length !== 12 || tag.length !== 16) {
      return '';
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('[Crypto Error] Failed to decrypt token (authentication tag mismatch or corrupted payload)');
    return '';
  }
}
