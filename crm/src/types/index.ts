export type LeadStage = 
  | 'NEW LEAD' 
  | 'HOT LEAD' 
  | 'NEED FOLLOW UP' 
  | 'WAITING PAYMENT' 
  | 'PRINTING' 
  | 'SHIPPED' 
  | 'GOING COLD';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  timeZone: string;
  avatarUrl: string;
  stage: LeadStage;
  totalOrders: number;
  totalSpendNgn: number;
  notes: string;
  source: string;
  createdAt: string;
}

export interface JerseyProduct {
  id: string;
  league: string;
  team: string;
  season: string;
  kitType: 'Home' | 'Away' | 'Third' | 'Goalkeeper';
  title: string;
  imageUrl: string;
  basePriceNgn: number;
  sizes: ('S' | 'M' | 'L' | 'XL' | 'XXL')[];
  inStock: boolean;
  description?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: 'customer' | 'agent' | 'system';
  direction: 'inbound' | 'outbound';
  type: 'text' | 'image' | 'interactive_kit' | 'payment_link' | 'system_alert';
  body: string;
  timestamp: string;
  deliveryStatus?: 'sent' | 'delivered' | 'read';
  kitData?: {
    jersey: JerseyProduct;
    selectedSize?: string;
    customName?: string;
    customNumber?: string;
    finalPriceNgn: number;
  };
  paymentData?: {
    orderNumber: number;
    amountNgn: number;
    paystackUrl: string;
    status: 'pending' | 'paid' | 'expired';
    expiresInMinutes: number;
  };
}

export interface ActiveOrder {
  id: string;
  orderNumber: number;
  status: 'pending_payment' | 'paid' | 'printing' | 'shipped' | 'delivered';
  jerseyTitle: string;
  size: string;
  customPrinting?: {
    name: string;
    number: string;
    badge?: string;
  };
  amountNgn: number;
  stockHoldExpiresAt: string; // ISO string
  trackingNumber?: string;
  shippingAddress: string;
  courier?: string;
}

export interface Conversation {
  id: string;
  customer: Customer;
  topic: string;
  unreadCount: number;
  lastMessageSnippet: string;
  lastMessageTime: string;
  isAiEnabled: boolean; // True = AI Auto-pilot, False = Human Takeover
  assignedAgent: {
    id: string;
    name: string;
    role: string;
    avatarUrl: string;
  };
  activeOrder?: ActiveOrder;
  mediaGallery: {
    id: string;
    url: string;
    type: 'image' | 'video';
    caption: string;
  }[];
}
