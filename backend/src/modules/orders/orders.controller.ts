import { Request, Response, NextFunction } from 'express';
import { ordersService } from './orders.service.js';
import { CreateOrderDTO, UpdateOrderStatusDTO, OrderFilterDTO } from './orders.types.js';

export const ordersController = {
  /**
   * GET /api/v1/orders
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters = req.query as unknown as OrderFilterDTO;
      const result = await ordersService.listOrders(req.organizationId, filters);
      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/orders/:id
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orderId = req.params.id as string;
      const order = await ordersService.getOrder(req.organizationId, orderId);
      if (!order) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Order not found' }
        });
        return;
      }
      res.json({ success: true, data: order });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/orders
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as CreateOrderDTO;
      const order = await ordersService.createOrder(req.organizationId, body);
      res.status(201).json({
        success: true,
        message: 'Order created with 15-minute stock reservation',
        data: order
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/orders/:id/status
   */
  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orderId = req.params.id as string;
      const body = req.body as UpdateOrderStatusDTO;
      const updated = await ordersService.updateStatus(req.organizationId, orderId, body);
      if (!updated) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Order not found' }
        });
        return;
      }
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
};
