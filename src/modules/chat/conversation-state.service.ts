import crypto from 'node:crypto';
import { prisma } from '../../core/database/prisma.js';
import { ConversationState, SESSION_TTL_MS } from './conversation-state.types.js';
import { Prisma } from '@prisma/client';

export const conversationStateService = {
  /**
   * Retrieves the current transactional commerce state.
   * Enforces session boundaries: if the active session is older than 30 minutes
   * or previously marked 'completed', it automatically spins up a fresh session
   * without destroying long-term customer history or past orders.
   */
  async getState(organizationId: string, conversationId: string): Promise<ConversationState> {
    try {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { state: true }
      });

      const now = Date.now();

      if (!conv || !conv.state || typeof conv.state !== 'object') {
        return this.startNewSession(organizationId, conversationId);
      }

      const raw = conv.state as Record<string, unknown>;
      const sessionId = typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId : null;
      const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0;
      const stage = (raw.stage as ConversationState['stage']) || 'browsing';

      // Session expiration: Inactive for > 30 minutes or order already completed
      const isExpired = now - updatedAt > SESSION_TTL_MS;
      const isCompleted = stage === 'completed';

      if (!sessionId || isExpired || isCompleted) {
        return this.startNewSession(organizationId, conversationId);
      }

      return {
        sessionId,
        stage,
        jerseyId: typeof raw.jerseyId === 'string' ? raw.jerseyId : undefined,
        team: typeof raw.team === 'string' ? raw.team : undefined,
        kitType: typeof raw.kitType === 'string' ? raw.kitType : undefined,
        size: typeof raw.size === 'string' ? raw.size : undefined,
        quantity: typeof raw.quantity === 'number' ? raw.quantity : undefined,
        orderId: typeof raw.orderId === 'string' ? raw.orderId : undefined,
        updatedAt
      };
    } catch (err: unknown) {
      console.warn(`[ConversationState] Failed to load state for ${conversationId}:`, err);
      return {
        sessionId: crypto.randomUUID(),
        stage: 'browsing',
        updatedAt: Date.now()
      };
    }
  },

  /**
   * Starts a brand new shopping session.
   * Generates a new sessionId and resets transactional fields (jersey, size, order)
   * while keeping long-term customer identity, orders, and messages intact.
   */
  async startNewSession(organizationId: string, conversationId: string): Promise<ConversationState> {
    const freshState: ConversationState = {
      sessionId: crypto.randomUUID(),
      stage: 'browsing',
      updatedAt: Date.now()
    };

    try {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          state: freshState as unknown as Prisma.InputJsonValue
        }
      });
    } catch (err: unknown) {
      console.warn(`[ConversationState] Failed to persist new session for ${conversationId}:`, err);
    }

    return freshState;
  },

  /**
   * Updates the active commerce state with a partial patch within the current session.
   * Strictly keeps only active commerce fields to prevent database state dumping.
   */
  async updateState(
    organizationId: string,
    conversationId: string,
    patch: Partial<Omit<ConversationState, 'sessionId' | 'updatedAt'>>
  ): Promise<ConversationState> {
    try {
      const current = await this.getState(organizationId, conversationId);
      const next: ConversationState = {
        sessionId: current.sessionId,
        stage: patch.stage !== undefined ? patch.stage : current.stage,
        jerseyId: patch.jerseyId !== undefined ? patch.jerseyId : current.jerseyId,
        team: patch.team !== undefined ? patch.team : current.team,
        kitType: patch.kitType !== undefined ? patch.kitType : current.kitType,
        size: patch.size !== undefined ? patch.size : current.size,
        quantity: patch.quantity !== undefined ? patch.quantity : current.quantity,
        orderId: patch.orderId !== undefined ? patch.orderId : current.orderId,
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
      return {
        sessionId: crypto.randomUUID(),
        stage: patch.stage || 'browsing',
        updatedAt: Date.now()
      };
    }
  }
};
