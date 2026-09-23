export interface InitializePaymentDTO {
  orderId: string;
  email: string;
}

export interface PaystackInitResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    domain: string;
    status: string; // 'success', 'failed', 'abandoned'
    reference: string;
    amount: number; // in kobo / lowest currency unit
    currency: string;
    channel: string;
    gateway_response: string;
    paid_at: string;
    customer: {
      id: number;
      email: string;
      customer_code: string;
      phone?: string;
    };
    metadata?: Record<string, any>;
  };
}

export interface PaymentRecord {
  id: string;
  organizationId: string;
  orderId: string;
  paystackReference: string;
  amountPaid: number;
  currency: string;
  channel?: string | null;
  status: string;
  verifiedAt: string;
  createdAt: string;
}
