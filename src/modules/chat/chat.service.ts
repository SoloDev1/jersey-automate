import { chatRepository } from './chat.repository.js';
import { whatsappService } from '../whatsapp/whatsapp.service.js';
import { catalogService } from '../catalog/catalog.service.js';
import { prisma } from '../../core/database/prisma.js';
import { socketService } from '../../core/socket/socket.service.js';
import {
  ConversationRecord,
  MessageRecord,
  SendMessageDTO,
  SendKitCardDTO,
  ConversationFilterDTO
} from './chat.types.js';
import { PaginatedResult } from '../catalog/catalog.types.js';

export const chatService = {
  /**
   * Lists customer conversations.
   */
  async listConversations(
    organizationId: string,
    filter: ConversationFilterDTO
  ): Promise<PaginatedResult<ConversationRecord>> {
    return chatRepository.listConversations(organizationId, filter);
  },

  /**
   * Fetches message history and resets unread count.
   */
  async getMessages(
    organizationId: string,
    conversationId: string
  ): Promise<{ conversation: ConversationRecord; messages: MessageRecord[] }> {
    const conversation = await chatRepository.getConversationById(organizationId, conversationId);
    if (!conversation) {
      const notFoundErr = Object.assign(new Error(`Conversation ${conversationId} not found`), {
        statusCode: 404,
        code: 'CONVERSATION_NOT_FOUND'
      });
      throw notFoundErr;
    }

    // Reset unread count upon viewing
    await chatRepository.markAsRead(organizationId, conversationId);

    const messages = await chatRepository.getMessages(organizationId, conversationId);

    // Trigger double blue checkmarks (Seen) on customer's WhatsApp device
    const latestInbound = messages.filter((m) => m.direction === 'inbound' && m.metaMessageId).pop();
    if (latestInbound?.metaMessageId) {
      whatsappService.markMessageAsRead(organizationId, latestInbound.metaMessageId).catch(() => {});
    }

    return { conversation, messages };
  },

  /**
   * Sends a manual message from the store owner to a customer.
   * Instant Human Takeover: Disables AI auto-reply for this conversation.
   */
  async sendManualMessage(
    organizationId: string,
    dto: SendMessageDTO
  ): Promise<MessageRecord> {
    const conversation = await chatRepository.getConversationById(
      organizationId,
      dto.conversationId
    );
    if (!conversation || !conversation.customerPhone) {
      throw new Error(`Customer phone not found for conversation ${dto.conversationId}`);
    }

    // 1. Dispatch outbound text to WhatsApp Cloud API
    const metaMessageId = await whatsappService.sendTextMessage(organizationId, {
      toPhone: conversation.customerPhone,
      body: dto.message
    });

    // 2. Persist message to database
    const saved = await chatRepository.insertMessage(organizationId, {
      conversationId: dto.conversationId,
      metaMessageId,
      direction: 'outbound',
      type: 'text',
      body: dto.message,
      deliveryStatus: 'sent'
    });

    // 3. Human Takeover: Disable AI auto-reply so AI does not interject
    await chatRepository.setAiEnabled(organizationId, dto.conversationId, false);

    // 4. Real-time Socket.IO emission to connected CRM clients
    if (saved) {
      socketService.emitNewMessage(organizationId, saved);
    }
    const updatedConv = await chatRepository.getConversationById(organizationId, dto.conversationId);
    if (updatedConv) {
      socketService.emitConversationUpdated(organizationId, updatedConv);
    }

    return saved!;
  },

  /**
   * Sends an interactive jersey kit card with photo and price directly to customer's WhatsApp.
   */
  async sendKitCard(
    organizationId: string,
    dto: SendKitCardDTO
  ): Promise<MessageRecord> {
    const conversation = await chatRepository.getConversationById(
      organizationId,
      dto.conversationId
    );
    if (!conversation || !conversation.customerPhone) {
      throw new Error(`Customer phone not found for conversation ${dto.conversationId}`);
    }

    const jersey = await catalogService.getJersey(organizationId, dto.jerseyId);
    if (!jersey) {
      throw new Error(`Jersey ${dto.jerseyId} not found`);
    }

    // Retrieve store currency via Prisma
    const setting = await prisma.setting.findUnique({
      where: { organizationId },
      select: { currency: true }
    });

    const currency = setting?.currency || 'NGN';
    const price = dto.customPrice ?? jersey.basePrice;

    // Dispatch photo card via WhatsApp Cloud API
    const metaMessageId = await whatsappService.sendKitCard(organizationId, {
      toPhone: conversation.customerPhone,
      jerseyTitle: jersey.title,
      imageUrl: jersey.imageUrl,
      price,
      currency,
      description: jersey.description
    });

    // Persist outbound kit card message
    const saved = await chatRepository.insertMessage(organizationId, {
      conversationId: dto.conversationId,
      metaMessageId,
      direction: 'outbound',
      type: 'interactive_kit',
      body: `⚽ ${jersey.title} - ${currency} ${price}`,
      mediaUrl: jersey.imageUrl,
      jerseyId: jersey.id,
      deliveryStatus: 'sent'
    });

    // Real-time Socket.IO emission to connected CRM clients
    if (saved) {
      socketService.emitNewMessage(organizationId, saved);
    }
    const updatedConv = await chatRepository.getConversationById(organizationId, dto.conversationId);
    if (updatedConv) {
      socketService.emitConversationUpdated(organizationId, updatedConv);
    }

    return saved!;
  },

  /**
   * Enables or disables AI auto-reply for a customer conversation.
   */
  async toggleAi(
    organizationId: string,
    conversationId: string,
    isAiEnabled: boolean
  ): Promise<void> {
    await chatRepository.setAiEnabled(organizationId, conversationId, isAiEnabled);
    const updatedConv = await chatRepository.getConversationById(organizationId, conversationId);
    if (updatedConv) {
      socketService.emitConversationUpdated(organizationId, updatedConv);
    }
  },

  /**
   * Clears all message history for a conversation while retaining the conversation thread.
   */
  async clearChatHistory(organizationId: string, conversationId: string): Promise<void> {
    const conversation = await chatRepository.getConversationById(organizationId, conversationId);
    if (!conversation) {
      const notFoundErr = Object.assign(new Error(`Conversation ${conversationId} not found`), {
        statusCode: 404,
        code: 'CONVERSATION_NOT_FOUND'
      });
      throw notFoundErr;
    }

    await chatRepository.clearMessages(organizationId, conversationId);
    socketService.emitMessagesCleared(organizationId, conversationId);

    const updatedConv = await chatRepository.getConversationById(organizationId, conversationId);
    if (updatedConv) {
      socketService.emitConversationUpdated(organizationId, updatedConv);
    }
  },

  /**
   * Permanently deletes a conversation and all its messages.
   */
  async deleteConversation(organizationId: string, conversationId: string): Promise<void> {
    const conversation = await chatRepository.getConversationById(organizationId, conversationId);
    if (!conversation) {
      const notFoundErr = Object.assign(new Error(`Conversation ${conversationId} not found`), {
        statusCode: 404,
        code: 'CONVERSATION_NOT_FOUND'
      });
      throw notFoundErr;
    }

    await chatRepository.deleteConversation(organizationId, conversationId);
    socketService.emitConversationDeleted(organizationId, conversationId);
  }
};
