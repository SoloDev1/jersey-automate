export interface Conversation {
  id: string;
  organizationId: string;
  customerId: string;
  customerPhone?: string;
  customerName?: string | null;
  status: 'open' | 'needs_reply' | 'resolved' | 'archived';
  isAiEnabled: boolean;
  unreadCount: number;
  lastMessagePreview?: string | null;
  lastMessageAt?: string | null;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  metaMessageId?: string | null;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'image' | 'interactive_kit' | 'payment_link';
  body?: string | null;
  mediaUrl?: string | null;
  jerseyId?: string | null;
  jerseyTitle?: string | null;
  jerseyImage?: string | null;
  deliveryStatus?: 'received' | 'sent' | 'delivered' | 'read' | 'failed';
  createdAt: string;
}

export interface JerseyInventory {
  id: string;
  size: 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | '3XL';
  quantityOnHand: number;
  quantityReserved: number;
  quantityAvailable: number;
}

export interface Jersey {
  id: string;
  title: string;
  team: string;
  league: string;
  season: string;
  kitType: string;
  basePrice: number;
  imageUrl: string;
  description?: string | null;
  isActive: boolean;
  inventory?: JerseyInventory[];
}

export interface OrderItem {
  id: string;
  jerseyId: string;
  size: string;
  quantity: number;
  unitPrice: number;
  customName?: string | null;
  customNumber?: string | null;
  printingFee: number;
  jerseyTitle?: string;
  jerseyImage?: string;
}

export interface Order {
  id: string;
  orderNumber: number;
  customerPhone?: string;
  customerName?: string | null;
  subtotal: number;
  shippingFee: number;
  totalAmount: number;
  currency: string;
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  fulfillmentStatus: 'unfulfilled' | 'printing' | 'shipped' | 'delivered' | 'cancelled';
  paystackReference?: string | null;
  paymentUrl?: string | null;
  shippingAddress?: string | null;
  shippingTrackingNumber?: string | null;
  createdAt: string;
  items?: OrderItem[];
}

export interface AiBudget {
  organizationId: string;
  monthDate: string;
  maxBudgetUsd: number;
  currentSpendUsd: number;
  isLocked: boolean;
  isGloballyEnabled: boolean;
}

export interface WhatsAppStatus {
  isConnected: boolean;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  displayPhoneNumber?: string | null;
  updatedAt?: string | null;
}
