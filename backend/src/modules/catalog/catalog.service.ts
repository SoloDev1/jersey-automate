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

export const catalogService = {
  /**
   * Lists jerseys applying filters and stock calculations.
   */
  async getCatalog(
    organizationId: string,
    filter: CatalogFilterDTO
  ): Promise<PaginatedResult<JerseyRecord>> {
    return catalogRepository.listJerseys(organizationId, filter);
  },

  /**
   * Fetches single jersey with verified availability.
   */
  async getJersey(organizationId: string, id: string): Promise<JerseyRecord | null> {
    return catalogRepository.getJerseyById(organizationId, id);
  },

  /**
   * Creates a new jersey product with size inventory.
   */
  async createJersey(organizationId: string, dto: CreateJerseyDTO): Promise<JerseyRecord> {
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
    const jersey = await catalogRepository.getJerseyById(organizationId, jerseyId);
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
    return catalogRepository.deleteJersey(organizationId, id);
  }
};
