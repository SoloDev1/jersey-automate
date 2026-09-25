import { prisma } from '../../core/database/prisma.js';
import { ConversationState, DEFAULT_CONVERSATION_STATE } from './conversation-state.types.js';
import { Prisma } from '@prisma/client';

export const conversationStateService = {
  /**
   * Retrieves the current conversation state or default state if empty.
   */
  async getState(organizationId: string, conversationId: string): Promise<ConversationState> {
    try {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { state: true }
      });

      if (!conv || !conv.state || typeof conv.state !== 'object') {
        return { ...DEFAULT_CONVERSATION_STATE, updatedAt: Date.now() };
      }

      const raw = conv.state as Record<string, unknown>;
      return {
        stage: (raw.stage as ConversationState['stage']) || 'browsing',
        jerseyId: typeof raw.jerseyId === 'string' ? raw.jerseyId : undefined,
        team: typeof raw.team === 'string' ? raw.team : undefined,
        kitType: typeof raw.kitType === 'string' ? raw.kitType : undefined,
        size: typeof raw.size === 'string' ? raw.size : undefined,
        quantity: typeof raw.quantity === 'number' ? raw.quantity : undefined,
        orderId: typeof raw.orderId === 'string' ? raw.orderId : undefined,
        orderNumber: typeof raw.orderNumber === 'number' ? raw.orderNumber : undefined,
        paymentUrl: typeof raw.paymentUrl === 'string' ? raw.paymentUrl : undefined,
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
      };
    } catch (err: unknown) {
      console.warn(`[ConversationState] Failed to load state for ${conversationId}:`, err);
      return { ...DEFAULT_CONVERSATION_STATE, updatedAt: Date.now() };
    }
  },

  /**
   * Updates state with a partial patch.
   */
  async updateState(
    organizationId: string,
    conversationId: string,
    patch: Partial<ConversationState>
  ): Promise<ConversationState> {
    try {
      const current = await this.getState(organizationId, conversationId);
      const next: ConversationState = {
        ...current,
        ...patch,
        updatedAt: Date.now()
      };

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          state: next as unknown as Prisma.InputJsonValue
        }
      });

      return next;
    } catch (err: unknown) {
      console.warn(`[ConversationState] Failed to persist state for ${conversationId}:`, err);
      return { ...DEFAULT_CONVERSATION_STATE, ...patch, updatedAt: Date.now() };
    }
  },

  /**
   * Resets conversation state back to browsing stage.
   */
  async resetState(organizationId: string, conversationId: string): Promise<ConversationState> {
    return this.updateState(organizationId, conversationId, {
      stage: 'browsing',
      jerseyId: undefined,
      team: undefined,
      kitType: undefined,
      size: undefined,
      quantity: undefined,
      orderId: undefined,
      orderNumber: undefined,
      paymentUrl: undefined
    });
  }
};
