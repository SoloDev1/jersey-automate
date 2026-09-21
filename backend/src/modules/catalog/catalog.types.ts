export type JerseySize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | '3XL';

export interface JerseyInventoryRecord {
  id: string;
  organizationId: string;
  jerseyId: string;
  size: JerseySize;
  quantityOnHand: number;
  quantityReserved: number;
  quantityAvailable: number; // Computed: on_hand - reserved
  updatedAt: string;
}

export interface JerseyRecord {
  id: string;
  organizationId: string;
  discoveredKitId: string | null;
  title: string;
  league: string;
  team: string;
  season: string;
  kitType: string;
  basePrice: number;
  imageUrl: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  inventory?: JerseyInventoryRecord[];
}

export interface CreateJerseyDTO {
  title: string;
  league: string;
  team: string;
  season: string;
  kitType: string;
  basePrice: number;
  imageUrl: string;
  description?: string;
  discoveredKitId?: string;
  initialStock?: Partial<Record<JerseySize, number>>;
}

export interface UpdateJerseyDTO {
  title?: string;
  basePrice?: number;
  imageUrl?: string;
  description?: string;
  isActive?: boolean;
}

export interface AdjustStockDTO {
  size: JerseySize;
  quantityDelta: number; // positive to restock, negative to reduce
  reason?: string;
  actor?: string;
}

export interface CatalogFilterDTO {
  league?: string;
  team?: string;
  season?: string;
  kitType?: string;
  size?: JerseySize;
  inStock?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
