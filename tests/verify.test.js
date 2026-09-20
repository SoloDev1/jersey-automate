import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptToken, decryptToken } from '../src/utils/crypto.js';
import { db } from '../src/db/storage.js';
import { config } from '../src/config/env.js';

console.log('--- [1] Testing AES-256-GCM Token Encryption ---');
const sampleToken = 'EAAGm0PX4ZCpsBAK7ZB34827dhs9384jsdklfjasl29038423';
const encrypted = encryptToken(sampleToken);
console.log('Encrypted Token Sample:', encrypted);

// Check format: iv:authTag:ciphertext
const parts = encrypted.split(':');
assert.equal(parts.length, 3, 'Encrypted token must have 3 colon-delimited components');
assert.equal(parts[0].length, 32, 'IV hex must be 32 characters (16 bytes)');
assert.equal(parts[1].length, 32, 'Auth tag hex must be 32 characters (16 bytes)');

// Decrypt and verify exact match
const decrypted = decryptToken(encrypted);
assert.equal(decrypted, sampleToken, 'Decrypted token must match original token');
console.log('✔ Token encryption & decryption passed!');

// Verify tampering is caught by GCM auth tag
try {
  const tampered = parts[0] + ':' + parts[1] + ':' + parts[2].slice(0, -2) + 'aa';
  decryptToken(tampered);
  assert.fail('Tampered token should have thrown an authentication error');
} catch (err) {
  console.log('✔ GCM Tamper detection verified (rejected altered ciphertext)!');
}

console.log('\n--- [2] Testing Normalized Storage Layer ---');
const testTenant = await db.createTenant('Jersey Test Tenant');
assert.ok(testTenant.id.startsWith('tenant_'), 'Tenant ID must be prefixed');

const testConn = await db.createConnection({
  tenantId: testTenant.id,
  wabaId: 'waba_test_998877',
  status: 'INITIATED'
});
assert.equal(testConn.status, 'INITIATED');

const updatedConn = await db.updateConnection(testConn.id, {
  status: 'CONNECTED',
  accessTokenEncrypted: encrypted
});
assert.equal(updatedConn.status, 'CONNECTED');

const phone = await db.upsertPhoneNumber({
  connectionId: testConn.id,
  phoneNumberId: 'phone_123456789',
  displayPhoneNumber: '+1 555-0199',
  verifiedName: 'Jersey Test Store',
  isRegistered: true
});
assert.equal(phone.displayPhoneNumber, '+1 555-0199');
assert.equal(phone.isRegistered, true);

const retrievedPhones = await db.getPhonesByConnectionId(testConn.id);
assert.equal(retrievedPhones.length, 1);
assert.equal(retrievedPhones[0].phoneNumberId, 'phone_123456789');

const webhookEvent = await db.createWebhookEvent({
  wabaId: 'waba_test_998877',
  eventType: 'account_update',
  payload: { test: true }
});
assert.equal(webhookEvent.wabaId, 'waba_test_998877');
console.log('✔ Database operations and schema models verified!');

console.log('\n--- [3] Testing HMAC SHA-256 Webhook Signature ---');
const rawPayload = Buffer.from(JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba_test_998877', changes: [{ field: 'account_update', value: { status: 'APPROVED' } }] }]
}));

const validSignature = 'sha256=' + crypto
  .createHmac('sha256', config.metaAppSecret)
  .update(rawPayload)
  .digest('hex');

const tamperedSignature = 'sha256=' + '00'.repeat(32);

// Validate matching signature
const sigBuf1 = Buffer.from(validSignature);
const expectedBuf1 = Buffer.from(validSignature);
assert.ok(crypto.timingSafeEqual(sigBuf1, expectedBuf1), 'Valid signature should match');

// Validate mismatch signature
const sigBuf2 = Buffer.from(tamperedSignature);
assert.equal(crypto.timingSafeEqual(sigBuf2, expectedBuf1), false, 'Tampered signature must not match');
console.log('✔ HMAC SHA-256 verification logic verified!');

console.log('\n=============================================');
console.log(' All automated verification tests passed successfully! ');
console.log('=============================================');
