import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve('.data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Initialize database file if it doesn't exist
function initDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const defaultData = {
      tenants: [
        {
          id: 'tenant_demo_01',
          name: 'Jersey Demo Enterprise',
          createdAt: new Date().toISOString()
        }
      ],
      connections: [],
      phoneNumbers: [],
      webhookEvents: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
  }
}

initDb();

function readDb() {
  initDb();
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export const db = {
  // --- Tenants ---
  async getTenant(tenantId) {
    const data = readDb();
    return data.tenants.find((t) => t.id === tenantId) || null;
  },

  async createTenant(name) {
    const data = readDb();
    const newTenant = {
      id: `tenant_${crypto.randomBytes(6).toString('hex')}`,
      name,
      createdAt: new Date().toISOString()
    };
    data.tenants.push(newTenant);
    writeDb(data);
    return newTenant;
  },

  // --- WhatsApp Connections ---
  async getConnectionByTenant(tenantId) {
    const data = readDb();
    return data.connections.find((c) => c.tenantId === tenantId) || null;
  },

  async getConnectionByWabaId(wabaId) {
    const data = readDb();
    return data.connections.find((c) => c.wabaId === wabaId) || null;
  },

  async getConnectionById(id) {
    const data = readDb();
    return data.connections.find((c) => c.id === id) || null;
  },

  async createConnection({ tenantId, wabaId, businessId = null, accessTokenEncrypted = '', status = 'INITIATED' }) {
    const data = readDb();
    const newConn = {
      id: `conn_${crypto.randomBytes(8).toString('hex')}`,
      tenantId,
      wabaId,
      businessId,
      accessTokenEncrypted,
      status,
      lastError: null,
      tokenExpiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    data.connections.push(newConn);
    writeDb(data);
    return newConn;
  },

  async updateConnection(id, updates) {
    const data = readDb();
    const index = data.connections.findIndex((c) => c.id === id);
    if (index === -1) return null;

    data.connections[index] = {
      ...data.connections[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    writeDb(data);
    return data.connections[index];
  },

  // --- WhatsApp Phone Numbers ---
  async getPhonesByConnectionId(connectionId) {
    const data = readDb();
    return data.phoneNumbers.filter((p) => p.connectionId === connectionId);
  },

  async getPhoneByNumberId(phoneNumberId) {
    const data = readDb();
    return data.phoneNumbers.find((p) => p.phoneNumberId === phoneNumberId) || null;
  },

  async upsertPhoneNumber({
    connectionId,
    phoneNumberId,
    displayPhoneNumber = null,
    verifiedName = null,
    qualityRating = null,
    codeVerificationStatus = null,
    isRegistered = false
  }) {
    const data = readDb();
    const index = data.phoneNumbers.findIndex((p) => p.phoneNumberId === phoneNumberId);

    const now = new Date().toISOString();
    if (index >= 0) {
      data.phoneNumbers[index] = {
        ...data.phoneNumbers[index],
        connectionId,
        displayPhoneNumber,
        verifiedName,
        qualityRating,
        codeVerificationStatus,
        isRegistered,
        updatedAt: now
      };
      writeDb(data);
      return data.phoneNumbers[index];
    }

    const newPhone = {
      id: `phone_${crypto.randomBytes(6).toString('hex')}`,
      connectionId,
      phoneNumberId,
      displayPhoneNumber,
      verifiedName,
      qualityRating,
      codeVerificationStatus,
      isRegistered,
      createdAt: now,
      updatedAt: now
    };
    data.phoneNumbers.push(newPhone);
    writeDb(data);
    return newPhone;
  },

  // --- Webhook Events ---
  async createWebhookEvent({ wabaId, eventType, payload }) {
    const data = readDb();
    const event = {
      id: `evt_${crypto.randomBytes(8).toString('hex')}`,
      wabaId: wabaId || null,
      eventType: eventType || 'unknown',
      payload,
      processed: false,
      createdAt: new Date().toISOString()
    };
    data.webhookEvents.push(event);
    writeDb(data);
    return event;
  },

  async listWebhookEvents(limit = 20) {
    const data = readDb();
    return data.webhookEvents.slice(-limit).reverse();
  }
};
