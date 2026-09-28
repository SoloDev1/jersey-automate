export interface StoreSettingsDto {
  organizationId: string;
  storeName: string;
  storeCategory: string;
  businessDescription: string | null;
  storeEmoji: string;
  currency: string;
  defaultShippingFee: number;
  customPrintingFee: number;
  customOptionTitle: string | null;
  customOptionFee: number | null;
  aiPersonaTone: string;
  customStorePolicies: string | null;
  outOfScopeMessage: string | null;
  clarificationMessage: string | null;
  brandKeywords: string[];
  categoryKeywords: string[];
  isWhatsappConnected: boolean;
  aiEnabledGlobally: boolean;
  maxMonthlyAiBudgetUsd: number;
  updatedAt: string;
}

export interface UpdateStoreSettingsDto {
  storeName?: string;
  storeCategory?: string;
  businessDescription?: string;
  storeEmoji?: string;
  currency?: string;
  defaultShippingFee?: number;
  customPrintingFee?: number;
  customOptionTitle?: string;
  customOptionFee?: number;
  aiPersonaTone?: string;
  customStorePolicies?: string;
  outOfScopeMessage?: string;
  clarificationMessage?: string;
  brandKeywords?: string[];
  categoryKeywords?: string[];
  aiEnabledGlobally?: boolean;
  maxMonthlyAiBudgetUsd?: number;
}
