import { db } from '../db/storage.js';
import { metaGraphService } from '../services/metaGraphService.js';
import { encryptToken, decryptToken } from '../utils/crypto.js';

export const onboardingController = {
  /**
   * Main onboarding entrypoint.
   * Exchanging the short-lived code, verifying WABA ownership, subscribing,
   * fetching phone numbers, and encrypting credentials.
   */
  async onboard(req, res) {
    const tenant = req.tenant;
    const { code, accessToken: directAccessToken, hints } = req.body;

    if (!code && !directAccessToken) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_AUTHORIZATION',
        message: 'The Meta authorization code or access token is required.'
      });
    }

    let connection = null;

    try {
      // 1. Initialize or find connection in INITIATED state
      const existing = await db.getConnectionByTenant(tenant.id);
      if (existing) {
        connection = await db.updateConnection(existing.id, {
          status: 'INITIATED',
          lastError: null
        });
      } else {
        connection = await db.createConnection({
          tenantId: tenant.id,
          wabaId: `PENDING_${Date.now()}`,
          status: 'INITIATED'
        });
      }

      // 2. Token Resolution (exchanged from code or provided directly by SDK)
      let accessToken = directAccessToken;
      let expiresIn = null;

      if (code) {
        const tokenResult = await metaGraphService.exchangeCodeForToken(code);
        accessToken = tokenResult.accessToken;
        expiresIn = tokenResult.expiresIn;
      }

      await db.updateConnection(connection.id, {
        status: 'TOKEN_EXCHANGED'
      });

      // 3. Server-side Token Inspection & Validation
      const tokenDebug = await metaGraphService.debugToken(accessToken);

      // 4. Verify or Auto-Discover WABA Identity
      let candidateWabaId = hints?.waba_id;
      if (!candidateWabaId) {
        candidateWabaId = await metaGraphService.discoverWaba(accessToken, tokenDebug);
      }

      const verifiedWaba = await metaGraphService.getWaba(candidateWabaId, accessToken);

      await db.updateConnection(connection.id, {
        wabaId: candidateWabaId,
        businessId: verifiedWaba.id ? candidateWabaId : hints?.business_id || null,
        status: 'WABA_VERIFIED'
      });

      // 5. Subscribe App to WABA Webhooks
      await metaGraphService.subscribeWaba(candidateWabaId, accessToken);

      await db.updateConnection(connection.id, {
        status: 'WABA_SUBSCRIBED'
      });

      // 6. Query Discovered Phone Numbers
      const phoneList = await metaGraphService.getPhoneNumbers(candidateWabaId, accessToken);

      // Persist discovered phone numbers
      for (const phone of phoneList) {
        await db.upsertPhoneNumber({
          connectionId: connection.id,
          phoneNumberId: phone.id,
          displayPhoneNumber: phone.display_phone_number,
          verifiedName: phone.verified_name,
          qualityRating: phone.quality_rating,
          codeVerificationStatus: phone.code_verification_status,
          isRegistered: phone.code_verification_status === 'VERIFIED'
        });
      }

      // 7. Encrypt Token at Rest & Mark CONNECTED
      const encryptedAccessToken = encryptToken(accessToken);

      await db.updateConnection(connection.id, {
        wabaId: candidateWabaId,
        accessTokenEncrypted: encryptedAccessToken,
        status: 'CONNECTED',
        lastError: null,
        tokenExpiresAt: expiresIn
          ? new Date(Date.now() + expiresIn * 1000).toISOString()
          : null
      });

      const updatedPhones = await db.getPhonesByConnectionId(connection.id);

      return res.status(200).json({
        success: true,
        message: 'WhatsApp Business Account successfully connected.',
        connection: {
          wabaId: candidateWabaId,
          status: 'CONNECTED',
          phoneNumbers: updatedPhones.map((p) => ({
            id: p.phoneNumberId,
            displayPhoneNumber: p.displayPhoneNumber,
            verifiedName: p.verifiedName,
            isRegistered: p.isRegistered
          }))
        }
      });

    } catch (err) {
      console.error('[WhatsApp Onboarding Error Details]', {
        tenantId: tenant.id,
        connectionId: connection?.id,
        errorMessage: err.message,
        metaError: err.metaError || null
      });

      if (connection) {
        await db.updateConnection(connection.id, {
          status: 'FAILED',
          lastError: err.message
        });
      }

      // Return error with diagnostic detail
      return res.status(500).json({
        success: false,
        code: 'WHATSAPP_ONBOARDING_FAILED',
        message: 'We were unable to complete the WhatsApp connection.',
        detail: err.message
      });
    }
  },

  /**
   * Retrieves the current WhatsApp connection and registered numbers for the tenant.
   */
  async getConnectionStatus(req, res) {
    const tenant = req.tenant;
    const connection = await db.getConnectionByTenant(tenant.id);

    if (!connection) {
      return res.json({
        status: 'DISCONNECTED',
        phoneNumbers: []
      });
    }

    const phoneNumbers = await db.getPhonesByConnectionId(connection.id);

    return res.json({
      id: connection.id,
      wabaId: connection.wabaId,
      status: connection.status,
      lastError: connection.lastError,
      createdAt: connection.createdAt,
      phoneNumbers: phoneNumbers.map((p) => ({
        id: p.phoneNumberId,
        displayPhoneNumber: p.displayPhoneNumber,
        verifiedName: p.verifiedName,
        qualityRating: p.qualityRating,
        isRegistered: p.isRegistered
      }))
    });
  },

  /**
   * Requests an OTP verification code sent to the phone number.
   */
  async requestPhoneCode(req, res) {
    const tenant = req.tenant;
    const { phoneNumberId, method } = req.body;

    if (!phoneNumberId) {
      return res.status(400).json({ error: 'phoneNumberId is required.' });
    }

    const connection = await db.getConnectionByTenant(tenant.id);
    if (!connection || !connection.accessTokenEncrypted) {
      return res.status(400).json({ error: 'No active WhatsApp connection found.' });
    }

    try {
      const accessToken = decryptToken(connection.accessTokenEncrypted);
      const result = await metaGraphService.requestCode(phoneNumberId, accessToken, method || 'SMS');
      return res.json({ success: true, message: `Verification code sent via ${method || 'SMS'}.`, result });
    } catch (err) {
      console.error('[Request Code Error]', err);
      return res.status(500).json({ error: err.message });
    }
  },

  /**
   * Submits the OTP verification code and registers the number for Cloud API.
   */
  async verifyPhoneCode(req, res) {
    const tenant = req.tenant;
    const { phoneNumberId, code, pin } = req.body;

    if (!phoneNumberId || !code) {
      return res.status(400).json({ error: 'phoneNumberId and 6-digit code are required.' });
    }

    const connection = await db.getConnectionByTenant(tenant.id);
    if (!connection || !connection.accessTokenEncrypted) {
      return res.status(400).json({ error: 'No active WhatsApp connection found.' });
    }

    try {
      const accessToken = decryptToken(connection.accessTokenEncrypted);
      // 1. Verify OTP code
      await metaGraphService.verifyCode(phoneNumberId, accessToken, code);

      // 2. Register number with PIN
      const registerPin = pin && /^\d{6}$/.test(pin) ? pin : '123456';
      await metaGraphService.registerPhoneNumber(phoneNumberId, accessToken, registerPin);

      // 3. Mark number as registered in DB
      await db.upsertPhoneNumber({
        connectionId: connection.id,
        phoneNumberId,
        isRegistered: true,
        codeVerificationStatus: 'VERIFIED'
      });

      return res.json({ success: true, message: 'Phone number verified and registered successfully!' });
    } catch (err) {
      console.error('[Verify Code Error]', err);
      return res.status(500).json({ error: err.message });
    }
  },

  /**
   * Disconnects WhatsApp integration for this tenant.
   */
  async disconnect(req, res) {
    const tenant = req.tenant;
    const connection = await db.getConnectionByTenant(tenant.id);

    if (connection) {
      await db.updateConnection(connection.id, {
        status: 'DISCONNECTED',
        accessTokenEncrypted: ''
      });
    }

    return res.json({
      success: true,
      message: 'WhatsApp account disconnected.'
    });
  }
};
