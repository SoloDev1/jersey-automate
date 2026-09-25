import { prisma } from '../../core/database/prisma.js';
import { Prisma } from '@prisma/client';
import {
  ConversationRecord,
  MessageRecord,
  ConversationFilterDTO
} from './chat.types.js';
import { PaginatedResult } from '../catalog/catalog.types.js';

// Fully-typed payload with included customer fields - zero `any`
type ConversationWithCustomer = Prisma.ConversationGetPayload<{
  include: {
    customer: {
      select: {
        phoneNumber: true;
        displayName: true;
        shippingAddress: true;
        notes: true;
        totalOrders: true;
        totalSpend: true;
      };
    };
  };
}>;

// Fully-typed payload with joined jersey details - zero `any`
type MessageWithJersey = Prisma.MessageGetPayload<{
  include: {
    jersey: {
      select: {
        title: true;
        imageUrl: true;
      };
    };
  };
}>;

// Monotonic delivery status progression weight to prevent out-of-order webhook regressions
const DELIVERY_STATUS_RANK: Record<string, number> = {
  received: 1,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 99
};

/**
 * Transforms a Prisma conversation entity with joined customer to the domain ConversationRecord.
 */
function mapConversationToRecord(row: ConversationWithCustomer): ConversationRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    customerId: row.customerId,
    status: row.status as 'open' | 'needs_reply' | 'resolved' | 'archived',
    isAiEnabled: row.isAiEnabled,
    lastMessagePreview: row.lastMessagePreview,
    lastMessageAt: row.lastMessageAt.toISOString(),
    unreadCount: row.unreadCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    customerPhone: row.customer.phoneNumber,
    customerName: row.customer.displayName ?? undefined,
    customerAddress: row.customer.shippingAddress,
    customerNotes: row.customer.notes,
    customerTotalOrders: row.customer.totalOrders,
    customerTotalSpend: Number(row.customer.totalSpend)
  };
}

/**
 * Transforms a Prisma message entity with joined jersey to the domain MessageRecord.
 */
function mapMessageToRecord(row: MessageWithJersey): MessageRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    conversationId: row.conversationId,
    metaMessageId: row.metaMessageId,
    direction: row.direction as 'inbound' | 'outbound',
    type: row.type as 'text' | 'image' | 'interactive_kit' | 'payment_link',
    body: row.body,
    mediaUrl: row.mediaUrl,
    jerseyId: row.jerseyId,
    deliveryStatus: row.deliveryStatus as 'received' | 'sent' | 'delivered' | 'read' | 'failed',
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    jerseyTitle: row.jersey?.title ?? undefined,
    jerseyImage: row.jersey?.imageUrl ?? undefined
  };
}

export const chatRepository = {
  /**
   * Lists customer conversation threads with unread counts and latest snippet.
   */
  async listConversations(
    organizationId: string,
    filter: ConversationFilterDTO
  ): Promise<PaginatedResult<ConversationRecord>> {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filter.limit) || 30));
    const offset = (page - 1) * limit;

    const where: Prisma.ConversationWhereInput = {
      organizationId
    };

    if (filter.status) {
      where.status = filter.status;
    }

    const [rows, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          customer: {
            select: {
              phoneNumber: true,
              displayName: true,
              shippingAddress: true,
              notes: true,
              totalOrders: true,
              totalSpend: true
            }
          }
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.conversation.count({ where })
    ]);

    return {
      data: rows.map(mapConversationToRecord),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit)
      }
    };
  },

  /**
   * Retrieves single conversation details by UUID scoped strictly by tenant organizationId.
   */
  async getConversationById(
    organizationId: string,
    conversationId: string
  ): Promise<ConversationRecord | null> {
    const row = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId
      },
      include: {
        customer: {
          select: {
            phoneNumber: true,
            displayName: true,
            shippingAddress: true,
            notes: true,
            totalOrders: true,
            totalSpend: true
          }
        }
      }
    });

    if (!row) return null;
    return mapConversationToRecord(row);
  },

  /**
   * Concurrency-safe atomic find-or-create using database-level UPSERT.
   * Backed by PostgreSQL @@unique([organizationId, customerId]) to eliminate duplicate conversation races.
   */
  async findOrCreateConversation(
    organizationId: string,
    customerId: string
  ): Promise<ConversationRecord> {
    const row = await prisma.conversation.upsert({
      where: {
        uq_org_customer_conversation: {
          organizationId,
          customerId
        }
      },
      update: {}, // Existing conversation is returned untouched without mutating state
      create: {
        organizationId,
        customerId,
        status: 'open',
        isAiEnabled: true
      },
      include: {
        customer: {
          select: {
            phoneNumber: true,
            displayName: true,
            shippingAddress: true,
            notes: true,
            totalOrders: true,
            totalSpend: true
          }
        }
      }
    });

    return mapConversationToRecord(row);
  },

  /**
   * Retrieves chronological messages with deterministic pagination.
   * Loads the latest messages first, supporting backward cursor pagination (beforeMessageId).
   */
  async getMessages(
    organizationId: string,
    conversationId: string,
    limit = 50,
    beforeMessageId?: string
  ): Promise<MessageRecord[]> {
    const clampedLimit = Math.min(200, Math.max(1, limit));

    const rows = await prisma.message.findMany({
      where: {
        organizationId,
        conversationId
      },
      cursor: beforeMessageId ? { id: beforeMessageId } : undefined,
      skip: beforeMessageId ? 1 : 0,
      // Deterministic composite order: newest first for instant chat loading
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' }
      ],
      take: clampedLimit,
      include: {
        jersey: {
          select: {
            title: true,
            imageUrl: true
          }
        }
      }
    });

    // Reverse to chronological order (oldest to newest) for UI chat rendering
    return rows.reverse().map(mapMessageToRecord);
  },

  /**
   * Inserts a message and atomically updates conversation preview, timestamp, and unread count.
   * 1. Validates that conversationId strictly belongs to organizationId (tenant isolation).
   * 2. Enforces database-level uniqueness on metaMessageId (handling concurrent webhook P2002 errors).
   */
  async insertMessage(
    organizationId: string,
    data: {
      conversationId: string;
      metaMessageId?: string | null;
      direction: 'inbound' | 'outbound';
      type: 'text' | 'image' | 'interactive_kit' | 'payment_link';
      body?: string | null;
      mediaUrl?: string | null;
      jerseyId?: string | null;
      deliveryStatus?: 'received' | 'sent' | 'delivered' | 'read' | 'failed';
    }
  ): Promise<MessageRecord | null> {
    return prisma.$transaction(async (tx) => {
      // 1. Tenant boundary verification: prevent cross-tenant conversation injection
      const conversation = await tx.conversation.findFirst({
        where: {
          id: data.conversationId,
          organizationId
        },
        select: { id: true }
      });

      if (!conversation) {
        throw new Error(
          `Tenant isolation violation: Conversation ${data.conversationId} not found in organization ${organizationId}`
        );
      }

      // 2. Fast-path deduplication check
      if (data.metaMessageId) {
        const existing = await tx.message.findUnique({
          where: { metaMessageId: data.metaMessageId },
          select: { id: true }
        });

        if (existing) {
          return null; // Duplicate webhook dropped cleanly
        }
      }

      // 3. Insert message with P2002 race protection
      let created: MessageWithJersey;
      try {
        created = await tx.message.create({
          data: {
            organizationId,
            conversationId: data.conversationId,
            metaMessageId: data.metaMessageId || null,
            direction: data.direction,
            type: data.type,
            body: data.body || null,
            mediaUrl: data.mediaUrl || null,
            jerseyId: data.jerseyId || null,
            deliveryStatus: data.deliveryStatus || (data.direction === 'inbound' ? 'received' : 'sent')
          },
          include: {
            jersey: {
              select: {
                title: true,
                imageUrl: true
              }
            }
          }
        });
      } catch (err: unknown) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Database unique constraint caught a concurrent duplicate webhook
          return null;
        }
        throw err;
      }

      // 4. Atomically update parent conversation snippet, timestamp, and unread counters
      const previewText =
        data.body || (data.type === 'interactive_kit' ? '⚽ Jersey Card' : 'Media attachment');

      const conversationUpdate: Prisma.ConversationUpdateInput = {
        lastMessagePreview: previewText.slice(0, 150),
        lastMessageAt: new Date()
      };

      if (data.direction === 'inbound') {
        conversationUpdate.status = 'needs_reply';
        conversationUpdate.unreadCount = { increment: 1 };
      }

      await tx.conversation.updateMany({
        where: {
          id: data.conversationId,
          organizationId
        },
        data: conversationUpdate
      });

      return mapMessageToRecord(created);
    });
  },

  /**
   * Sets AI auto-reply enabled or disabled for a conversation (Human Takeover).
   */
  async setAiEnabled(
    organizationId: string,
    conversationId: string,
    isAiEnabled: boolean
  ): Promise<void> {
    await prisma.conversation.updateMany({
      where: {
        id: conversationId,
        organizationId
      },
      data: {
        isAiEnabled
      }
    });
  },

  /**
   * Resets unread counter to 0 when a conversation is opened.
   */
  async markAsRead(organizationId: string, conversationId: string): Promise<void> {
    await prisma.conversation.updateMany({
      where: {
        id: conversationId,
        organizationId
      },
      data: {
        unreadCount: 0
      }
    });
  },

  /**
   * Updates message delivery status from Meta webhooks.
   * Enforces monotonic transitions so out-of-order delivery receipts cannot revert 'read' to 'delivered'.
   */
  async updateMessageStatus(
    metaMessageId: string,
    status: 'delivered' | 'read' | 'failed',
    errorMessage?: string,
    organizationId?: string
  ): Promise<void> {
    // 1. Fetch current message status
    const current = await prisma.message.findFirst({
      where: {
        metaMessageId,
        ...(organizationId ? { organizationId } : {})
      },
      select: { id: true, deliveryStatus: true }
    });

    if (!current) return;

    // 2. Monotonic transition guard: ignore out-of-order older status webhooks
    const currentRank = DELIVERY_STATUS_RANK[current.deliveryStatus] || 0;
    const newRank = DELIVERY_STATUS_RANK[status] || 0;

    if (newRank < currentRank && status !== 'failed') {
      return; // Do not regress (e.g. do not downgrade 'read' to 'delivered')
    }

    const data: Prisma.MessageUpdateInput = {
      deliveryStatus: status
    };

    if (errorMessage) {
      data.errorMessage = errorMessage;
    }

    await prisma.message.update({
      where: { id: current.id },
      data
    });
  },

  /**
   * Deletes all messages in a conversation and clears preview/unread count.
   */
  async clearMessages(organizationId: string, conversationId: string): Promise<void> {
    await prisma.$transaction([
      prisma.message.deleteMany({
        where: {
          conversationId,
          organizationId
        }
      }),
      prisma.conversation.updateMany({
        where: {
          id: conversationId,
          organizationId
        },
        data: {
          lastMessagePreview: null,
          unreadCount: 0,
          updatedAt: new Date()
        }
      })
    ]);
  },

  /**
   * Permanently deletes a conversation.
   * Cascade delete automatically cleans up all associated messages and AI logs.
   */
  async deleteConversation(organizationId: string, conversationId: string): Promise<void> {
    await prisma.conversation.deleteMany({
      where: {
        id: conversationId,
        organizationId
      }
    });
  }
};
