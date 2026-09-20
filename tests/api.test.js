process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';
import { config } from '../src/config/env.js';

const server = startServer(0);
const assignedPort = server.address().port;
const BASE_URL = `http://localhost:${assignedPort}`;

async function runApiTests() {
  try {
    console.log('--- [1] Testing /health endpoint ---');
    const healthRes = await fetch(`${BASE_URL}/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, 'ok');
    console.log('✔ Health endpoint is working');

    console.log('\n--- [2] Testing /api/config endpoint ---');
    const configRes = await fetch(`${BASE_URL}/api/config`);
    assert.equal(configRes.status, 200);
    const configData = await configRes.json();
    assert.ok('appId' in configData);
    assert.ok('configId' in configData);
    assert.ok('graphApiVersion' in configData);
    console.log('✔ Public config endpoint is working');

    console.log('\n--- [3] Testing /api/whatsapp/status endpoint ---');
    const statusRes = await fetch(`${BASE_URL}/api/whatsapp/status`, {
      headers: { Authorization: 'Bearer tenant_demo_01' }
    });
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.ok(statusData.status);
    console.log('✔ WhatsApp connection status endpoint is working:', statusData.status);

    console.log('\n--- [4] Testing Webhook GET challenge handshake ---');
    const challenge = 'test_challenge_12345';
    const hookRes = await fetch(
      `${BASE_URL}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${config.webhookVerifyToken}&hub.challenge=${challenge}`
    );
    assert.equal(hookRes.status, 200);
    const text = await hookRes.text();
    assert.equal(text, challenge);
    console.log('✔ Webhook verification challenge passed');

    console.log('\n=============================================');
    console.log(' All API integration tests passed successfully! ');
    console.log('=============================================');
  } finally {
    server.close();
  }
}

runApiTests();
