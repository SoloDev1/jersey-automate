import { config } from '../config/env.js';

const GRAPH_BASE_URL = `https://graph.facebook.com/${config.graphApiVersion}`;

export const metaGraphService = {
  /**
   * Exchanges the short-lived OAuth authorization code (TTL: 30 seconds)
   * for a client WABA access token.
   */
  async exchangeCodeForToken(code) {
    const url = new URL(`https://graph.facebook.com/${config.graphApiVersion}/oauth/access_token`);
    url.searchParams.append('client_id', config.metaAppId);
    url.searchParams.append('client_secret', config.metaAppSecret);
    url.searchParams.append('code', code);

    const res = await fetch(url.toString());
    const data = await res.json();

    if (data.error) {
      const err = new Error(data.error.message || 'Meta OAuth code exchange failed');
      err.metaError = data.error;
      throw err;
    }

    return {
      accessToken: data.access_token,
      tokenType: data.token_type || 'bearer',
      expiresIn: data.expires_in || null
    };
  },

  /**
   * Inspects and validates token claims via Meta's /debug_token endpoint.
   * Ensures the token was actually issued by our App and is valid.
   */
  async debugToken(accessToken) {
    const appAccessToken = `${config.metaAppId}|${config.metaAppSecret}`;
    const url = new URL('https://graph.facebook.com/debug_token');
    url.searchParams.append('input_token', accessToken);
    url.searchParams.append('access_token', appAccessToken);

    const res = await fetch(url.toString());
    const data = await res.json();

    if (data.error || !data.data?.is_valid) {
      const err = new Error(data.error?.message || 'Access token is invalid or expired.');
      err.metaError = data.error || data.data;
      throw err;
    }

    return data.data; // contains app_id, scopes, user_id, granular_scopes, etc.
  },

  /**
   * Discovers the user's WABA ID automatically if not provided in hints.
   * Inspects debug_token granular_scopes and /me endpoints.
   */
  async discoverWaba(accessToken, debugData) {
    // 1. Try granular_scopes from debug_token
    if (debugData?.granular_scopes) {
      const scope = debugData.granular_scopes.find(
        (s) => s.scope === 'whatsapp_business_management'
      );
      if (scope?.target_ids && scope.target_ids.length > 0) {
        return scope.target_ids[0];
      }
    }

    // 2. Try /me/client_whatsapp_business_accounts
    try {
      const res = await fetch(`${GRAPH_BASE_URL}/me/client_whatsapp_business_accounts`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      if (data.data && data.data.length > 0) {
        return data.data[0].id;
      }
    } catch (_) {}

    // 3. Try /me?fields=whatsapp_business_accounts
    try {
      const res = await fetch(`${GRAPH_BASE_URL}/me?fields=whatsapp_business_accounts`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      if (data.whatsapp_business_accounts?.data?.length > 0) {
        return data.whatsapp_business_accounts.data[0].id;
      }
    } catch (_) {}

    // 4. Try /me/businesses?fields=id,name,owned_whatsapp_business_accounts
    try {
      const res = await fetch(`${GRAPH_BASE_URL}/me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      for (const b of data.data || []) {
        if (b.owned_whatsapp_business_accounts?.data?.length > 0) {
          return b.owned_whatsapp_business_accounts.data[0].id;
        }
      }
    } catch (_) {}

    // 5. Try finding WABA linked to the Meta App itself
    try {
      const appToken = `${config.metaAppId}|${config.metaAppSecret}`;
      const res = await fetch(`https://graph.facebook.com/${config.graphApiVersion}/${config.metaAppId}?fields=whatsapp_business_accounts{id,name}`, {
        headers: { Authorization: `Bearer ${appToken}` }
      });
      const data = await res.json();
      if (data.whatsapp_business_accounts?.data?.length > 0) {
        return data.whatsapp_business_accounts.data[0].id;
      }
    } catch (_) {}

    throw new Error('No WhatsApp Business Account (WABA) found. Please create one in business.facebook.com/settings/whatsapp-business-accounts or enter your WABA ID.');
  },

  /**
   * Reads WABA details directly from Graph API to verify ownership and retrieve metadata.
   */
  async getWaba(wabaId, accessToken) {
    const res = await fetch(`${GRAPH_BASE_URL}/${wabaId}?fields=id,name,currency,timezone_id,message_template_namespace`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    if (data.error) {
      const err = new Error(`Failed to verify WABA ${wabaId}: ${data.error.message}`);
      err.metaError = data.error;
      throw err;
    }

    return data;
  },

  /**
   * Subscribes this App to the client's WABA webhooks.
   * Required so our server receives incoming messages, status updates, and account events.
   */
  async subscribeWaba(wabaId, accessToken) {
    const res = await fetch(`${GRAPH_BASE_URL}/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await res.json();

    if (data.error || !data.success) {
      const err = new Error(`Failed to subscribe app to WABA: ${data.error?.message || 'Unknown error'}`);
      err.metaError = data.error || data;
      throw err;
    }

    return data;
  },

  /**
   * Retrieves phone numbers associated with this WABA.
   */
  async getPhoneNumbers(wabaId, accessToken) {
    const fields = 'id,display_phone_number,verified_name,quality_rating,code_verification_status,status';
    const res = await fetch(`${GRAPH_BASE_URL}/${wabaId}/phone_numbers?fields=${fields}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    if (data.error) {
      const err = new Error(`Failed to query WABA phone numbers: ${data.error.message}`);
      err.metaError = data.error;
      throw err;
    }

    return data.data || [];
  },

  /**
   * Registers a phone number with Cloud API if two-step verification is required.
   * Requires a tenant-provided 6-digit PIN.
   */
  async registerPhoneNumber(phoneNumberId, accessToken, pin) {
    if (!pin || !/^\d{6}$/.test(pin)) {
      throw new Error('Registration PIN must be a 6-digit numeric string.');
    }

    const res = await fetch(`${GRAPH_BASE_URL}/${phoneNumberId}/register`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        pin
      })
    });
    const data = await res.json();

    if (data.error) {
      const err = new Error(`Phone number registration failed: ${data.error.message}`);
      err.metaError = data.error;
      throw err;
    }

    return data;
  }
};
