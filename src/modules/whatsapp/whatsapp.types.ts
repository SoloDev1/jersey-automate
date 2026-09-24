export interface MetaOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface MetaDebugTokenResponse {
  data: {
    app_id: string;
    type: string;
    application: string;
    data_access_expires_at: number;
    expires_at: number;
    is_valid: boolean;
    scopes: string[];
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  };
}

export interface MetaPhoneNumber {
  id: string;
  display_phone_number: string;
  verified_name: string;
  quality_rating: string;
  code_verification_status: string;
}

export interface WhatsAppStatusResponse {
  isConnected: boolean;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  displayPhoneNumber?: string | null;
  updatedAt?: string | null;
}

export interface OnboardDTO {
  code?: string;
  accessToken?: string;
  wabaId?: string;
  phoneNumberId?: string;
}

export interface SendMessageOptions {
  toPhone: string;
  body: string;
}

export interface SendKitCardOptions {
  toPhone: string;
  jerseyTitle: string;
  imageUrl: string;
  price: number;
  currency: string;
  description?: string | null;
  paymentUrl?: string | null;
}
