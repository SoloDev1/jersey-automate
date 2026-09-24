import axios from 'axios';
import { env } from '../../core/config/env.js';
import { prisma } from '../../core/database/prisma.js';
import { encryptToken, decryptToken } from '../../core/utils/crypto.js';
import {
  MetaOAuthTokenResponse,
  MetaDebugTokenResponse,
  MetaPhoneNumber,
  WhatsAppStatusResponse,
  OnboardDTO,
  SendMessageOptions,
  SendKitCardOptions
} from './whatsapp.types.js';

const GRAPH_API_BASE = `https://graph.facebook.com/${env.GRAPH_API_VERSION}`;

/**
 * Strips sensitive Authorization headers from Axios errors to prevent token disclosure.
 */
function sanitizeMetaError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    if (error.config?.headers) {
      delete error.config.headers['Authorization'];
      delete error.config.headers['authorization'];
    }
    const metaMessage = error.response?.data?.error?.message || error.message;
    const metaCode = error.response?.data?.error?.code;
    return new Error(`Meta Graph API Error [code ${metaCode || 'unknown'}]: ${metaMessage}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export const whatsappService = {
  /**
   * Retrieves active decrypted credentials for an organization.
   */
  async getTenantCredentials(organizationId: string): Promise<{
    accessToken: string;
    phoneNumberId: string;
    wabaId: string;
    isConnected: boolean;
  }> {
    // 1. Try fetching dynamically from database settings
    try {
      const setting = await prisma.setting.findUnique({
        where: { organizationId },
        select: {
          accessTokenEncrypted: true,
          phoneNumberId: true,
          wabaId: true,
          isWhatsappConnected: true
        }
      });

      if (setting && setting.isWhatsappConnected && setting.phoneNumberId) {
        const decrypted = setting.accessTokenEncrypted
          ? decryptToken(setting.accessTokenEncrypted)
          : (env.WHATSAPP_ACCESS_TOKEN || env.META_SYSTEM_USER_TOKEN);

        if (decrypted) {
          return {
            accessToken: decrypted,
            phoneNumberId: setting.phoneNumberId,
            wabaId: setting.wabaId || env.WHATSAPP_BUSINESS_ACCOUNT_ID || env.DEFAULT_WABA_ID,
            isConnected: true
          };
        }
      }
    } catch (err: unknown) {
      // Fallback to .env below if database is unreachable or table not yet initialized
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[WhatsApp] Failed fetching DB credentials for org ${organizationId}:`, errMsg);
    }

    // 2. Fallback to environment variables (Standalone / Direct .env configuration)
    const envToken = env.WHATSAPP_ACCESS_TOKEN || env.META_SYSTEM_USER_TOKEN;
    const envPhoneId = env.WHATSAPP_PHONE_NUMBER_ID;
    const envWabaId = env.WHATSAPP_BUSINESS_ACCOUNT_ID || env.DEFAULT_WABA_ID;

    if (envToken && envPhoneId) {
      return {
        accessToken: envToken,
        phoneNumberId: envPhoneId,
        wabaId: envWabaId,
        isConnected: true
      };
    }

    return {
      accessToken: envToken || '',
      phoneNumberId: envPhoneId || '',
      wabaId: envWabaId || '',
      isConnected: false
    };
  },

  /**
   * Exchanges an OAuth authorization code for a long-lived Meta access token.
   */
  async exchangeCodeForToken(code: string): Promise<MetaOAuthTokenResponse> {
    try {
      const url = `${GRAPH_API_BASE}/oauth/access_token`;
      const res = await axios.get<MetaOAuthTokenResponse>(url, {
        params: {
          client_id: env.META_APP_ID,
          client_secret: env.META_APP_SECRET,
          code
        },
        timeout: 10000
      });
      return res.data;
    } catch (error) {
      throw sanitizeMetaError(error);
    }
  },

  /**
   * Inspects a Meta token to verify validity and scopes.
   */
  async debugToken(inputToken: string): Promise<MetaDebugTokenResponse['data']> {
    try {
      const appToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
      const url = `${GRAPH_API_BASE}/debug_token`;
      const res = await axios.get<MetaDebugTokenResponse>(url, {
        params: { input_token: inputToken, access_token: appToken },
        timeout: 10000
      });
      return res.data.data;
    } catch (error) {
      throw sanitizeMetaError(error);
    }
  },

  /**
   * Subscribes the Meta Developer App to receive WABA webhook events.
   */
  async subscribeWaba(wabaId: string, accessToken: string): Promise<boolean> {
    try {
      const url = `${GRAPH_API_BASE}/${wabaId}/subscribed_apps`;
      const res = await axios.post(url, {}, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000
      });
      return res.data.success === true;
    } catch (error) {
      throw sanitizeMetaError(error);
    }
  },

  /**
   * Fetches phone numbers associated with a WhatsApp Business Account.
   */
  async getPhoneNumbers(wabaId: string, accessToken: string): Promise<MetaPhoneNumber[]> {
    try {
      const url = `${GRAPH_API_BASE}/${wabaId}/phone_numbers`;
      const res = await axios.get<{ data: MetaPhoneNumber[] }>(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000
      });
      return res.data.data || [];
    } catch (error) {
      throw sanitizeMetaError(error);
    }
  },

  /**
   * Completes the Embedded Signup onboarding flow for an organization.
   */
  async onboardTenant(organizationId: string, dto: OnboardDTO): Promise<WhatsAppStatusResponse> {
    let accessToken = dto.accessToken;
    let wabaId = dto.wabaId;
    let phoneNumberId = dto.phoneNumberId;

    if (dto.code) {
      const tokenResult = await this.exchangeCodeForToken(dto.code);
      accessToken = tokenResult.access_token;
    }

    if (!accessToken) {
      throw new Error('Could not resolve a valid Meta access token');
    }

    // Auto-discover WABA if not supplied
    if (!wabaId) {
      const debug = await this.debugToken(accessToken);
      const granular = debug.granular_scopes?.find((s) => s.scope === 'whatsapp_business_management');
      wabaId = granular?.target_ids?.[0] || env.DEFAULT_WABA_ID;
    }

    if (!wabaId) {
      throw new Error('No WhatsApp Business Account (WABA) found for this token');
    }

    // Auto-subscribe webhooks
    await this.subscribeWaba(wabaId, accessToken);

    // Fetch phone numbers
    const phones = await this.getPhoneNumbers(wabaId, accessToken);
    const selectedPhone = phones.find((p) => p.id === phoneNumberId) || phones[0];

    const displayPhone = selectedPhone?.display_phone_number || null;
    const resolvedPhoneId = selectedPhone?.id || phoneNumberId || null;

    // Encrypt token before persisting
    const encrypted = encryptToken(accessToken);

    await prisma.setting.upsert({
      where: { organizationId },
      create: {
        organizationId,
        wabaId,
        phoneNumberId: resolvedPhoneId,
        displayPhoneNumber: displayPhone,
        accessTokenEncrypted: encrypted,
        isWhatsappConnected: true
      },
      update: {
        wabaId,
        phoneNumberId: resolvedPhoneId,
        displayPhoneNumber: displayPhone,
        accessTokenEncrypted: encrypted,
        isWhatsappConnected: true
      }
    });

    return {
      isConnected: true,
      wabaId,
      phoneNumberId: resolvedPhoneId,
      displayPhoneNumber: displayPhone,
      updatedAt: new Date().toISOString()
    };
  },

  /**
   * Retrieves current connection status for an organization.
   */
  async getStatus(organizationId: string): Promise<WhatsAppStatusResponse> {
    try {
      const setting = await prisma.setting.findUnique({
        where: { organizationId },
        select: {
          wabaId: true,
          phoneNumberId: true,
          displayPhoneNumber: true,
          isWhatsappConnected: true,
          updatedAt: true
        }
      });

      if (setting?.isWhatsappConnected) {
        return {
          isConnected: true,
          wabaId: setting.wabaId || null,
          phoneNumberId: setting.phoneNumberId || null,
          displayPhoneNumber: setting.displayPhoneNumber || null,
          updatedAt: setting.updatedAt?.toISOString() || null
        };
      }
    } catch {
      // Fallback to .env below
    }

    const creds = await this.getTenantCredentials(organizationId);
    return {
      isConnected: creds.isConnected,
      wabaId: creds.wabaId || null,
      phoneNumberId: creds.phoneNumberId || null,
      displayPhoneNumber: null,
      updatedAt: creds.isConnected ? new Date().toISOString() : null
    };
  },

  /**
   * Disconnects WhatsApp from an organization.
   */
  async disconnect(organizationId: string): Promise<void> {
    await prisma.setting.updateMany({
      where: { organizationId },
      data: {
        accessTokenEncrypted: null,
        isWhatsappConnected: false
      }
    });
  },

  /**
   * Sends an outbound text message to a customer over WhatsApp Cloud API.
   */
  async sendTextMessage(organizationId: string, options: SendMessageOptions): Promise<string> {
    const creds = await this.getTenantCredentials(organizationId);
    if (!creds.isConnected || !creds.phoneNumberId) {
      throw new Error(`WhatsApp is not connected for organization ${organizationId}`);
    }

    const cleanRecipient = options.toPhone.replace(/\+/g, '').trim();
    const url = `${GRAPH_API_BASE}/${creds.phoneNumberId}/messages`;

    try {
      const res = await axios.post<{ messages: Array<{ id: string }> }>(
        url,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanRecipient,
          type: 'text',
          text: { preview_url: true, body: options.body }
        },
        {
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return res.data.messages?.[0]?.id || `wamid_manual_${Date.now()}`;
    } catch (error) {
      throw sanitizeMetaError(error);
    }
  },

  /**
   * Sends a high-resolution jersey kit card with photo and buy link to customer's WhatsApp.
   */
  async sendKitCard(organizationId: string, options: SendKitCardOptions): Promise<string> {
    const creds = await this.getTenantCredentials(organizationId);
    if (!creds.isConnected || !creds.phoneNumberId) {
      throw new Error(`WhatsApp is not connected for organization ${organizationId}`);
    }

    const cleanRecipient = options.toPhone.replace(/\+/g, '').trim();
    const url = `${GRAPH_API_BASE}/${creds.phoneNumberId}/messages`;

    const formattedPrice = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: options.currency
    }).format(options.price);

    const captionText = [
      `*${options.jerseyTitle}*`,
      options.price > 0 ? `💰 Price: *${formattedPrice}*` : '',
      options.description ? `\n📝 ${options.description}` : '',
      options.paymentUrl ? `\n💳 *Order Here:* ${options.paymentUrl}` : ''
    ]
      .filter(Boolean)
      .join('\n');

    try {
      // Send high-res kit image with structured caption
      const res = await axios.post<{ messages: Array<{ id: string }> }>(
        url,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanRecipient,
          type: 'image',
          image: {
            link: options.imageUrl,
            caption: captionText
          }
        },
        {
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return res.data.messages?.[0]?.id || `wamid_kit_${Date.now()}`;
    } catch (error) {
      throw sanitizeMetaError(error);
    }
  },

  /**
   * Marks an incoming WhatsApp message as read (triggers blue checkmarks on customer device).
   */
  async markMessageAsRead(organizationId: string, messageId: string): Promise<boolean> {
    const creds = await this.getTenantCredentials(organizationId);
    if (!creds.isConnected || !creds.phoneNumberId) return false;

    const url = `${GRAPH_API_BASE}/${creds.phoneNumberId}/messages`;
    try {
      await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId
        },
        {
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
      return true;
    } catch {
      // Non-blocking: fail silently if message is already read or expired
      return false;
    }
  },

  /**
   * Shows a typing indicator ("typing...") on customer's WhatsApp chat.
   * Remains active until reply is sent or expires after 25 seconds.
   */
  async sendTypingIndicator(organizationId: string, messageId: string): Promise<boolean> {
    const creds = await this.getTenantCredentials(organizationId);
    if (!creds.isConnected || !creds.phoneNumberId) return false;

    const url = `${GRAPH_API_BASE}/${creds.phoneNumberId}/messages`;
    try {
      await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
          typing_indicator: {
            type: 'text'
          }
        },
        {
          headers: {
            Authorization: `Bearer ${creds.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
      return true;
    } catch {
      return false;
    }
  }
};
