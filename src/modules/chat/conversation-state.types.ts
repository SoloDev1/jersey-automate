export type ShoppingStage =
  | 'browsing'
  | 'selecting_kit'
  | 'viewing_product'
  | 'selecting_size'
  | 'confirming_order'
  | 'awaiting_payment'
  | 'completed';

export interface ConversationState {
  stage: ShoppingStage;
  jerseyId?: string;
  team?: string;
  kitType?: string;
  size?: string;
  quantity?: number;
  orderId?: string;
  orderNumber?: number;
  paymentUrl?: string;
  updatedAt: number;
}

export const DEFAULT_CONVERSATION_STATE: ConversationState = {
  stage: 'browsing',
  updatedAt: 0
};
