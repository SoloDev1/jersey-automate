import crypto from 'node:crypto';
import { env } from '../../core/config/env.js';
import { prisma } from '../../core/database/prisma.js';
import { Prisma } from '@prisma/client';
import { chatRepository } from '../chat/chat.repository.js';
import { ordersRepository } from '../orders/orders.repository.js';
import { socketService } from '../../core/socket/socket.service.js';
import { interactiveActionRouter } from './interactive-action.router.js';
import { conversationStateService } from '../chat/conversation-state.service.js';
import { whatsappActions } from '../whatsapp/whatsapp-actions.js';
import { whatsappService } from '../whatsapp/whatsapp.service.js';
import { JerseySize } from '../catalog/catalog.types.js';

function extractSizeFromText(text: string): JerseySize | null {
  const trimmed = text.trim().toLowerCase();
  const directMap: Record<string, JerseySize> = {
    xs: 'XS',
    extra_small: 'XS',
    s: 'S',
    small: 'S',
    the_small: 'S',
    m: 'M',
    medium: 'M',
    the_medium: 'M',
    l: 'L',
    large: 'L',
    the_large: 'L',
    xl: 'XL',
    extra_large: 'XL',
    xxl: 'XXL',
    '2xl': 'XXL',
    '3xl': '3XL',
    xxxl: '3XL'
  };

  const cleaned = trimmed.replace(/^(size|the size)\s+/i, '').replace(/\s+/g, '_');
  if (directMap[cleaned]) return directMap[cleaned];

  const match = trimmed.match(/\b(xs|s|m|l|xl|xxl|2xl|3xl|small|medium|large)\b/i);
  if (match && directMap[match[1].toLowerCase()]) {
    return directMap[match[1].toLowerCase()];
  }

  return null;
}

export interface MetaWebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type?: string; sha256?: string; caption?: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  button?: {
    text: string;
    payload?: string;
  };
}

export interface MetaWebhookStatus {
  id: string;
  status: 'delivered' | 'read' | 'failed' | 'sent';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{
    code: number;
    title: string;
    message?: string;
  }>;
}

export interface MetaWebhookValue {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: Array<{
    profile?: {
      name?: string;
    };
    wa_id?: string;
  }>;
  statuses?: MetaWebhookStatus[];
  messages?: MetaWebhookMessage[];
}

export interface MetaWebhookChange {
  value?: MetaWebhookValue;
  field?: string;
}

export interface MetaWebhookEntry {
  id: string;
  changes?: MetaWebhookChange[];
}

export interface MetaWebhookPayload {
  object: string;
  entry?: MetaWebhookEntry[];
}

export const MAX_WEBHOOK_AGE_MS = 10 * 60 * 1000; // 10 minutes maximum webhook age threshold

/**
 * Validates and parses Meta's incoming message timestamp.
 * - Converts integer seconds into a Date object.
 * - Handles clock skew into the future (> 60s clamped to receivedAt).
 * - Flags messages older than MAX_WEBHOOK_AGE_MS as stale.
 */
export function parseMetaTimestamp(
  rawTimestamp: string | number | undefined,
  receivedAt: Date = new Date()
): { messageTimestamp: Date; isStale: boolean; ageMs: number } {
  const epochSec = Number(rawTimestamp);
  let messageTimestamp: Date;

  if (isNaN(epochSec) || epochSec <= 0) {
    messageTimestamp = receivedAt;
  } else {
    messageTimestamp = new Date(epochSec * 1000);
  }

  // Future clock skew protection: clamp to receivedAt if > 60s into future
  if (messageTimestamp.getTime() > receivedAt.getTime() + 60_000) {
    messageTimestamp = receivedAt;
  }

  const ageMs = Math.max(0, receivedAt.getTime() - messageTimestamp.getTime());
  const isStale = ageMs > MAX_WEBHOOK_AGE_MS;

  return { messageTimestamp, isStale, ageMs };
}

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
   * Uses database-enforced idempotency locks on webhook_logs and messages to prevent duplicate processing.
   */
  async processMetaPayload(payload: MetaWebhookPayload | unknown): Promise<void> {
    if (
      !payload ||
      typeof payload !== 'object' ||
      (payload as MetaWebhookPayload).object !== 'whatsapp_business_account' ||
      !Array.isArray((payload as MetaWebhookPayload).entry)
    ) {
      return;
    }

    const data = payload as MetaWebhookPayload;
    if (!data.entry) return;

    for (const entry of data.entry) {
      if (!Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        const val = change.value;
        if (!val || val.messaging_product !== 'whatsapp') continue;

        // 1. Resolve Organization ID via phone_number_id (Multi-tenant)
        let organizationId = 'org_default';
        const phoneNumberId = val.metadata?.phone_number_id;

        if (phoneNumberId) {
          const orgSettings = await prisma.setting.findFirst({
            where: { phoneNumberId },
            select: { organizationId: true }
          });

          if (orgSettings?.organizationId) {
            organizationId = orgSettings.organizationId;
          }
        }

        // 2. Handle Message Status Updates (delivered, read, failed)
        if (Array.isArray(val.statuses)) {
          for (const statusObj of val.statuses) {
            const metaId = statusObj.id;
            const status = statusObj.status;
            const errorMsg = statusObj.errors?.[0]?.message;

            if (!['delivered', 'read', 'failed'].includes(status)) continue;

            // Database-level status deduplication log
            try {
              await prisma.webhookLog.create({
                data: {
                  organizationId,
                  source: 'whatsapp',
                  eventType: 'status',
                  idempotencyKey: `whatsapp:status:${metaId}:${status}`,
                  payload: statusObj as unknown as Prisma.InputJsonValue,
                  processed: true
                }
              });
            } catch (err: unknown) {
              if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                continue; // Duplicate status event safely ignored
              }
            }

            await chatRepository.updateMessageStatus(
              metaId,
              status as 'delivered' | 'read' | 'failed',
              errorMsg,
              organizationId
            );

            // Real-time Socket.IO emission for delivery receipts
            socketService.emitMessageStatus(organizationId, {
              metaMessageId: metaId,
              status: status as 'delivered' | 'read' | 'failed',
              error: errorMsg || null,
              organizationId
            });
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
            if (!fromPhone || !msg.id) continue;

            // Layer 1 Database Deduplication: webhook_logs unique idempotencyKey
            try {
              await prisma.webhookLog.create({
                data: {
                  organizationId,
                  source: 'whatsapp',
                  eventType: 'messages',
                  idempotencyKey: `whatsapp:msg:${msg.id}`,
                  payload: msg as unknown as Prisma.InputJsonValue,
                  processed: true
                }
              });
            } catch (err: unknown) {
              if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                console.log(`[Webhooks] Duplicate WhatsApp message ${msg.id} caught by idempotency log, skipping`);
                continue; // Duplicate webhook dropped: 0 AI runs, 0 DB mutations
              }
            }

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
            let actionId: string | undefined;

            if (msg.type === 'text' && msg.text?.body) {
              type = 'text';
              body = msg.text.body;
            } else if (msg.type === 'image') {
              type = 'image';
              body = msg.image?.caption || 'Customer sent a photo';
              mediaUrl = msg.image?.id
                ? `https://graph.facebook.com/${env.GRAPH_API_VERSION}/${msg.image.id}`
                : null;
            } else if (msg.type === 'interactive') {
              type = 'text';
              actionId = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id;
              body =
                msg.interactive?.button_reply?.title ||
                msg.interactive?.list_reply?.title ||
                'Interactive response';
            } else if (msg.type === 'button') {
              type = 'text';
              actionId = msg.button?.payload;
              body = msg.button?.text || 'Quick reply button';
            } else {
              body = `[${msg.type || 'unknown'} message]`;
            }

            // Parse and validate Meta send timestamp vs server receipt time
            const receivedAt = new Date();
            const { messageTimestamp, isStale, ageMs } = parseMetaTimestamp(msg.timestamp, receivedAt);

            // Layer 2 Database Deduplication & Accurate Timestamps
            const savedMessage = await chatRepository.insertMessage(organizationId, {
              conversationId: conversation.id,
              metaMessageId: msg.id,
              direction: 'inbound',
              type,
              body,
              mediaUrl,
              deliveryStatus: 'received',
              messageTimestamp,
              receivedAt,
              isStale
            });

            // Boundary 1: Stale Webhook Replay Guard
            // If the message is older than 10 minutes (e.g. Meta retry while offline), log to audit DB but STOP.
            if (isStale) {
              const staleMinutes = Math.round(ageMs / 60000);
              console.warn(
                `[Webhooks] Ignored stale WhatsApp message ${msg.id} from ${fromPhone} (sent ${staleMinutes}m ago on ${messageTimestamp.toISOString()}). Saved to audit ledger; AI pipeline & session clock bypassed.`
              );
              continue;
            }

            // Real-time Socket.IO emission to connected CRM clients
            if (savedMessage) {
              socketService.emitNewMessage(organizationId, savedMessage);
              const updatedConv = await chatRepository.getConversationById(organizationId, conversation.id);
              if (updatedConv) {
                socketService.emitConversationUpdated(organizationId, updatedConv);
              }

              // 1. Intercept deterministic button and list clicks: 0 LLM inference required
              let actionHandled = false;
              if (actionId && interactiveActionRouter.isHandled(actionId)) {
                actionHandled = true; // Recognised interactive action -> NEVER invoke AI
                await interactiveActionRouter.dispatch(actionId, {
                  organizationId,
                  conversationId: conversation.id,
                  customer
                });
              }

              // 2. Intercept state-driven text commands (e.g. typing "Medium", "M", "Cancel", "Buy"): 0 LLM inference required
              if (!actionHandled && body) {
                const trimmed = body.trim().toLowerCase();
                const state = await conversationStateService.getState(organizationId, conversation.id);

                if (/^(cancel|reset|restart|clear|start over)$/i.test(trimmed)) {
                  await conversationStateService.startNewSession(organizationId, conversation.id);
                  await whatsappService.sendTextMessage(organizationId, {
                    toPhone: fromPhone,
                    body: '🔄 Your shopping session has been reset. Which football club or jersey are you looking for today? ⚽'
                  });
                  actionHandled = true;
                } else {
                  const matchedSize = extractSizeFromText(trimmed);
                  let targetJerseyId = state.jerseyId;

                  // If state has no jerseyId, fall back to the most recent kit card sent in this thread
                  if (!targetJerseyId && matchedSize) {
                    const lastKitMsg = await prisma.message.findFirst({
                      where: {
                        conversationId: conversation.id,
                        direction: 'outbound',
                        type: 'interactive_kit',
                        jerseyId: { not: null }
                      },
                      orderBy: { createdAt: 'desc' },
                      select: { jerseyId: true }
                    });
                    if (lastKitMsg?.jerseyId) {
                      targetJerseyId = lastKitMsg.jerseyId;
                    }
                  }

                  if (matchedSize && targetJerseyId) {
                    actionHandled = true;
                    await interactiveActionRouter.dispatch(
                      whatsappActions.buildBuy(targetJerseyId, matchedSize),
                      {
                        organizationId,
                        conversationId: conversation.id,
                        customer
                      }
                    );
                  } else if (
                    state.stage === 'viewing_product' &&
                    state.jerseyId &&
                    /^(buy|order|purchase|checkout|sizes?|pick size|choose size)$/i.test(trimmed)
                  ) {
                    actionHandled = true;
                    await interactiveActionRouter.dispatch(
                      whatsappActions.buildSizes(state.jerseyId),
                      {
                        organizationId,
                        conversationId: conversation.id,
                        customer
                      }
                    );
                  }
                }
              }

              // 3. Trigger AI response strictly if message was not handled deterministically, AI is enabled, and message is fresh
              if (!actionHandled && conversation.isAiEnabled && body) {
                await webhooksService.triggerAiResponse(
                  organizationId,
                  conversation.id,
                  customer,
                  body,
                  messageTimestamp,
                  savedMessage.id
                );
              }
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
    incomingText: string,
    inboundTimestamp?: Date,
    currentMessageId?: string
  ): Promise<void> {
    try {
      const { aiService } = await import('../ai/ai.service.js');
      await aiService.handleInboundCustomerMessage(
        organizationId,
        conversationId,
        customer,
        incomingText,
        inboundTimestamp,
        currentMessageId
      );
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Webhooks] Failed executing background AI auto-reply:', errMsg);
    }
  }
};

