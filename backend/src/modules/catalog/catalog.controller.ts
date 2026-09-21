import { Request, Response, NextFunction } from 'express';
import { catalogService } from './catalog.service.js';
import { CatalogFilterDTO, CreateJerseyDTO, UpdateJerseyDTO, AdjustStockDTO } from './catalog.types.js';

export const catalogController = {
  /**
   * GET /api/v1/catalog
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters = req.query as unknown as CatalogFilterDTO;
      const result = await catalogService.getCatalog(req.organizationId, filters);
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
   * GET /api/v1/catalog/:id
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jerseyId = req.params.id as string;
      const jersey = await catalogService.getJersey(req.organizationId, jerseyId);
      if (!jersey) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Jersey not found' }
        });
        return;
      }
      res.json({ success: true, data: jersey });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/catalog
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as CreateJerseyDTO;
      const jersey = await catalogService.createJersey(req.organizationId, body);
      res.status(201).json({ success: true, data: jersey });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/catalog/:id
   */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jerseyId = req.params.id as string;
      const body = req.body as UpdateJerseyDTO;
      const updated = await catalogService.updateJersey(req.organizationId, jerseyId, body);
      if (!updated) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Jersey not found' }
        });
        return;
      }
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/catalog/:id/stock
   */
  async adjustStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jerseyId = req.params.id as string;
      const body = req.body as AdjustStockDTO;
      const inventory = await catalogService.adjustStock(req.organizationId, jerseyId, body);
      res.json({
        success: true,
        message: 'Stock updated successfully',
        data: inventory
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/v1/catalog/:id
   */
  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jerseyId = req.params.id as string;
      const success = await catalogService.deactivateJersey(req.organizationId, jerseyId);
      res.json({ success, message: 'Jersey deactivated' });
    } catch (error) {
      next(error);
    }
  }
};
