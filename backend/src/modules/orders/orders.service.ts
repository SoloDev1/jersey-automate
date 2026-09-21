import { ordersRepository } from './orders.repository.js';
import {
  OrderRecord,
  CreateOrderDTO,
  UpdateOrderStatusDTO,
  OrderFilterDTO
} from './orders.types.js';
import { PaginatedResult } from '../catalog/catalog.types.js';

export const ordersService = {
  /**
   * Creates an order and locks inventory for 15 minutes.
   */
  async createOrder(organizationId: string, dto: CreateOrderDTO): Promise<OrderRecord> {
    return ordersRepository.createOrderWithReservation(organizationId, dto, 15);
  },

  /**
   * Retrieves single order by ID.
   */
  async getOrder(organizationId: string, id: string): Promise<OrderRecord | null> {
    return ordersRepository.getOrderById(organizationId, id);
  },

  /**
   * Lists orders with filters and pagination.
   */
  async listOrders(
    organizationId: string,
    filter: OrderFilterDTO
  ): Promise<PaginatedResult<OrderRecord>> {
    return ordersRepository.listOrders(organizationId, filter);
  },

  /**
   * Updates fulfillment status or tracking number.
   */
  async updateStatus(
    organizationId: string,
    id: string,
    dto: UpdateOrderStatusDTO
  ): Promise<OrderRecord | null> {
    return ordersRepository.updateStatus(organizationId, id, dto);
  }
};
