export interface MessageRecord {
  id: string;
  organizationId: string;
  conversationId: string;
  metaMessageId?: string | null;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'image' | 'interactive_kit' | 'payment_link';
  body?: string | null;
  mediaUrl?: string | null;
  jerseyId?: string | null;
  deliveryStatus: 'received' | 'sent' | 'delivered' | 'read' | 'failed';
  errorMessage?: string | null;
  createdAt: string;
  jerseyTitle?: string;
  jerseyImage?: string;
}

export interface ConversationRecord {
  id: string;
  organizationId: string;
  customerId: string;
  status: 'open' | 'needs_reply' | 'resolved' | 'archived';
  isAiEnabled: boolean;
  lastMessagePreview?: string | null;
  lastMessageAt: string;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
  customerPhone?: string;
  customerName?: string;
}

export interface SendMessageDTO {
  conversationId: string;
  message: string;
}

export interface SendKitCardDTO {
  conversationId: string;
  jerseyId: string;
  customPrice?: number;
}

export interface ToggleAiDTO {
  isAiEnabled: boolean;
}

export interface ConversationFilterDTO {
  status?: 'open' | 'needs_reply' | 'resolved' | 'archived';
  search?: string;
  page?: number;
  limit?: number;
}
