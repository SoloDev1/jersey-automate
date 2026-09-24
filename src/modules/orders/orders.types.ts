import { JerseySize } from '../catalog/catalog.types.js';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type FulfillmentStatus = 'unfulfilled' | 'printing' | 'shipped' | 'delivered' | 'cancelled';

export interface OrderItemRecord {
  id: string;
  orderId: string;
  jerseyId: string;
  size: JerseySize;
  quantity: number;
  unitPrice: number;
  customName?: string | null;
  customNumber?: string | null;
  printingFee: number;
  createdAt: string;
  jerseyTitle?: string;
  jerseyImage?: string;
}

export interface OrderRecord {
  id: string;
  organizationId: string;
  orderNumber: number;
  customerId: string;
  subtotal: number;
  shippingFee: number;
  totalAmount: number;
  currency: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  paystackReference?: string | null;
  paystackAccessCode?: string | null;
  paymentUrl?: string | null;
  reservationExpiresAt?: string | null;
  shippingAddress?: string | null;
  shippingTrackingNumber?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  items?: OrderItemRecord[];
  customerPhone?: string;
  customerName?: string;
}

export interface CreateOrderItemInput {
  jerseyId: string;
  size: JerseySize;
  quantity: number;
  customName?: string;
  customNumber?: string;
}

export interface CreateOrderDTO {
  customerPhone: string;
  customerName?: string;
  items: CreateOrderItemInput[];
  shippingAddress?: string;
  notes?: string;
}

export interface UpdateOrderStatusDTO {
  fulfillmentStatus?: FulfillmentStatus;
  shippingTrackingNumber?: string;
  notes?: string;
}

export interface OrderFilterDTO {
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
  customerPhone?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export type OrderAddressUpdateCode =
  | 'ADDRESS_UPDATED'
  | 'ORDER_HANDED_TO_COURIER'
  | 'ORDER_ALREADY_SHIPPED'
  | 'ORDER_ALREADY_DELIVERED'
  | 'ORDER_CANCELLED'
  | 'ORDER_NOT_FOUND';

export interface UpdateOrderAddressInput {
  organizationId: string;
  customerId: string;
  orderIdentifier?: string; // Accepts string representation (e.g. "10042", "#10042", or UUID)
  shippingAddress: string;
  deliveryNotes?: string;
  conversationId: string;
}

export interface UpdateOrderAddressResult {
  success: boolean;
  code: OrderAddressUpdateCode;
  orderNumber?: number;
  orderId?: string;
  fulfillmentStatus?: FulfillmentStatus;
  trackingNumber?: string | null;
  previousAddress?: string | null;
  updatedAddress?: string;
  previousDeliveryNotes?: string | null;
  updatedDeliveryNotes?: string;
  message: string;
  instruction: string;
}

