import crypto from 'node:crypto';
import { env } from '../../core/config/env.js';
import { supabase } from '../../core/database/supabase.js';
import { chatRepository } from '../chat/chat.repository.js';
import { ordersRepository } from '../orders/orders.repository.js';

export const webhooksService = {
  /**
   * Verifies Meta GET webhook verification challenge handshake using constant-time comparison.
   */
  verifyMetaChallenge(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined
  ): { isValid: boolean; challenge?: string } {
    if (!mode || !token || !challenge || mode !== 'subscribe') {
      return { isValid: false };
    }

    const tokenBuf = Buffer.from(token, 'utf8');
    const expectedBuf = Buffer.from(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, 'utf8');

    if (tokenBuf.length !== expectedBuf.length) {
      return { isValid: false };
    }

    try {
      if (crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
        return { isValid: true, challenge };
      }
    } catch {
      return { isValid: false };
    }

    return { isValid: false };
  },

  /**
   * Timing-safe verification of the x-hub-signature-256 header.
   */
  verifyMetaSignature(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined
  ): boolean {
    // In development or when META_APP_SECRET is not configured, bypass signature check
    if (!env.META_APP_SECRET) {
      if (env.NODE_ENV === 'production') {
        console.error('[Webhooks] META_APP_SECRET is not configured in production environment');
        return false;
      }
      return true;
    }

    if (!rawBody || !signatureHeader) {
      return false;
    }

    const parts = signatureHeader.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') {
      return false;
    }

    const signatureHex = parts[1];
    // Enforce valid hex format
    if (!/^[0-9a-fA-F]+$/.test(signatureHex)) {
      return false;
    }

    try {
      const expectedHash = crypto
        .createHmac('sha256', env.META_APP_SECRET)
        .update(rawBody)
        .digest('hex');

      const sigBuf = Buffer.from(signatureHex, 'hex');
      const expectedBuf = Buffer.from(expectedHash, 'hex');

      if (sigBuf.length !== expectedBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  },

  /**
   * Asynchronously processes incoming WhatsApp Cloud API events.
   */
  async processMetaPayload(payload: any): Promise<void> {
    if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
      return;
    }

    for (const entry of payload.entry) {
      if (!Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        const val = change.value;
        if (!val || val.messaging_product !== 'whatsapp') continue;

        // 1. Resolve Organization ID via phone_number_id (Multi-tenant)
        let organizationId = 'org_default';
        const phoneNumberId = val.metadata?.phone_number_id;

        if (phoneNumberId) {
          const { data: orgSettings } = await supabase
            .from('settings')
            .select('organization_id')
            .eq('phone_number_id', phoneNumberId)
            .maybeSingle();

          if (orgSettings?.organization_id) {
            organizationId = orgSettings.organization_id;
          }
        }

        // 2. Handle Message Status Updates (delivered, read, failed)
        if (Array.isArray(val.statuses)) {
          for (const statusObj of val.statuses) {
            const metaId = statusObj.id;
            const status = statusObj.status;
            const errorMsg = statusObj.errors?.[0]?.message;

            if (['delivered', 'read', 'failed'].includes(status)) {
              await chatRepository.updateMessageStatus(metaId, status, errorMsg);
            }
          }
        }

        // 3. Handle Inbound Customer Messages
        if (Array.isArray(val.messages)) {
          const contactsMap = new Map<string, string>();
          if (Array.isArray(val.contacts)) {
            for (const contact of val.contacts) {
              if (contact.wa_id && contact.profile?.name) {
                contactsMap.set(contact.wa_id, contact.profile.name);
              }
            }
          }

          for (const msg of val.messages) {
            const fromPhone = msg.from;
            if (!fromPhone) continue;

            const displayName = contactsMap.get(fromPhone);
            const customer = await ordersRepository.findOrCreateCustomer(
              organizationId,
              fromPhone,
              displayName
            );

            const conversation = await chatRepository.findOrCreateConversation(
              organizationId,
              customer.id
            );

            let type: 'text' | 'image' | 'interactive_kit' | 'payment_link' = 'text';
            let body: string | null = null;
            let mediaUrl: string | null = null;

            if (msg.type === 'text' && msg.text?.body) {
              type = 'text';
              body = msg.text.body;
            } else if (msg.type === 'image') {
              type = 'image';
              body = msg.image?.caption || 'Customer sent a photo';
              mediaUrl = msg.image?.id ? `https://graph.facebook.com/${env.GRAPH_API_VERSION}/${msg.image.id}` : null;
            } else if (msg.type === 'interactive') {
              type = 'text';
              body = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || 'Interactive response';
            } else if (msg.type === 'button') {
              type = 'text';
              body = msg.button?.text || 'Quick reply button';
            } else {
              body = `[${msg.type || 'unknown'} message]`;
            }

            // Deduplication via unique wamid in chatRepository.insertMessage
            const savedMessage = await chatRepository.insertMessage(organizationId, {
              conversationId: conversation.id,
              metaMessageId: msg.id,
              direction: 'inbound',
              type,
              body,
              mediaUrl,
              deliveryStatus: 'received'
            });

            // If newly saved and AI is enabled for this conversation, trigger AI agent hook
            if (savedMessage && conversation.isAiEnabled && body) {
              await webhooksService.triggerAiResponse(
                organizationId,
                conversation.id,
                customer,
                body
              );
            }
          }
        }
      }
    }
  },

  /**
   * Hook for triggering AI Sales Assistant auto-reply.
   */
  async triggerAiResponse(
    organizationId: string,
    conversationId: string,
    customer: { id: string; phoneNumber: string; displayName: string | null },
    incomingText: string
  ): Promise<void> {
    try {
      const { aiService } = await import('../ai/ai.service.js');
      await aiService.handleInboundCustomerMessage(
        organizationId,
        conversationId,
        customer,
        incomingText
      );
    } catch (error) {
      console.error('[Webhooks] Failed executing background AI auto-reply:', error);
    }
  }
};
