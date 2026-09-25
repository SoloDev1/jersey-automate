export type ShoppingStage =
  | 'browsing'
  | 'selecting_kit'
  | 'viewing_product'
  | 'selecting_size'
  | 'confirming_order'
  | 'awaiting_payment'
  | 'completed';

/**
 * Ephemeral Transactional Commerce State.
 * Strictly limited to active shopping session fields.
 * Does NOT store long-term customer profiles, chat messages, or payment blobs.
 */
export interface ConversationState {
  sessionId: string;
  stage: ShoppingStage;
  jerseyId?: string;
  team?: string;
  kitType?: string;
  size?: string;
  quantity?: number;
  orderId?: string;
  updatedAt: number;
}

export const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes inactivity timeout
