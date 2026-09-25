import { catalogRepository } from './catalog.repository.js';
import {
  JerseyRecord,
  JerseyInventoryRecord,
  CreateJerseyDTO,
  UpdateJerseyDTO,
  AdjustStockDTO,
  CatalogFilterDTO,
  PaginatedResult,
  JerseySize
} from './catalog.types.js';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const catalogCache = new Map<string, CacheEntry<PaginatedResult<JerseyRecord>>>();
const jerseyCache = new Map<string, CacheEntry<JerseyRecord | null>>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes TTL

function clearOrgCache(organizationId: string): void {
  for (const key of catalogCache.keys()) {
    if (key.startsWith(`${organizationId}:`)) {
      catalogCache.delete(key);
    }
  }
  for (const key of jerseyCache.keys()) {
    if (key.startsWith(`${organizationId}:`)) {
      jerseyCache.delete(key);
    }
  }
}

export const catalogService = {
  /**
   * Lists jerseys applying filters and stock calculations with in-memory caching.
   */
  async getCatalog(
    organizationId: string,
    filter: CatalogFilterDTO
  ): Promise<PaginatedResult<JerseyRecord>> {
    const cacheKey = `${organizationId}:${JSON.stringify(filter)}`;
    const cached = catalogCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const result = await catalogRepository.listJerseys(organizationId, filter);
    catalogCache.set(cacheKey, { data: result, expiresAt: now + CACHE_TTL_MS });
    return result;
  },

  /**
   * Fetches single jersey with verified availability with in-memory caching.
   */
  async getJersey(organizationId: string, id: string): Promise<JerseyRecord | null> {
    const cacheKey = `${organizationId}:${id}`;
    const cached = jerseyCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const result = await catalogRepository.getJerseyById(organizationId, id);
    jerseyCache.set(cacheKey, { data: result, expiresAt: now + CACHE_TTL_MS });
    return result;
  },

  /**
   * Creates a new jersey product with size inventory.
   */
  async createJersey(organizationId: string, dto: CreateJerseyDTO): Promise<JerseyRecord> {
    clearOrgCache(organizationId);
    return catalogRepository.createJersey(organizationId, dto);
  },

  /**
   * Updates an existing jersey.
   */
  async updateJersey(
    organizationId: string,
    id: string,
    dto: UpdateJerseyDTO
  ): Promise<JerseyRecord | null> {
    clearOrgCache(organizationId);
    return catalogRepository.updateJersey(organizationId, id, dto);
  },

  /**
   * Adjusts stock quantity for a size and verifies non-negative availability.
   */
  async adjustStock(
    organizationId: string,
    jerseyId: string,
    dto: AdjustStockDTO
  ): Promise<JerseyInventoryRecord> {
    clearOrgCache(organizationId);
    return catalogRepository.adjustInventory(
      organizationId,
      jerseyId,
      dto.size,
      dto.quantityDelta,
      dto.actor || 'store_owner',
      dto.reason || 'Manual stock adjustment'
    );
  },

  /**
   * Checks if a specific size is available for sale.
   */
  async isSizeAvailable(
    organizationId: string,
    jerseyId: string,
    size: JerseySize,
    requestedQuantity = 1
  ): Promise<{ available: boolean; remaining: number; price: number }> {
    const jersey = await this.getJersey(organizationId, jerseyId);
    if (!jersey || !jersey.isActive) {
      return { available: false, remaining: 0, price: 0 };
    }

    const sizeRecord = jersey.inventory?.find((inv) => inv.size === size);
    if (!sizeRecord) {
      return { available: false, remaining: 0, price: jersey.basePrice };
    }

    const available = sizeRecord.quantityAvailable >= requestedQuantity;
    return {
      available,
      remaining: sizeRecord.quantityAvailable,
      price: jersey.basePrice
    };
  },

  /**
   * Soft-deactivates a jersey.
   */
  async deactivateJersey(organizationId: string, id: string): Promise<boolean> {
    clearOrgCache(organizationId);
    return catalogRepository.deleteJersey(organizationId, id);
  }
};
