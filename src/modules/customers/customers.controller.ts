import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../core/database/prisma.js';
import { Prisma } from '@prisma/client';

export const customersController = {
  /**
   * GET /api/v1/customers
   * Lists customers for the organization with search and defensive pagination.
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const search = req.query.search as string | undefined;
      const organizationId = req.organizationId || 'org_default';

      // Defensive pagination boundaries
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      const offset = (page - 1) * limit;

      const where: Prisma.CustomerWhereInput = {
        organizationId
      };

      if (search && search.trim()) {
        const term = search.trim();
        where.OR = [
          { displayName: { contains: term, mode: 'insensitive' } },
          { phoneNumber: { contains: term, mode: 'insensitive' } }
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          orderBy: { lastContactAt: 'desc' },
          skip: offset,
          take: limit
        }),
        prisma.customer.count({ where })
      ]);

      res.json({
        success: true,
        data: rows.map((row) => ({
          id: row.id,
          name: row.displayName || 'Customer',
          phone: row.phoneNumber,
          address: row.shippingAddress,
          notes: row.notes,
          totalOrders: row.totalOrders,
          totalSpend: Number(row.totalSpend),
          lastContactAt: row.lastContactAt.toISOString(),
          createdAt: row.createdAt.toISOString()
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / limit)
        },
        total
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/customers/:id
   * Retrieves single customer by UUID scoped strictly by tenant organizationId.
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const organizationId = req.organizationId || 'org_default';

      const row = await prisma.customer.findFirst({
        where: {
          id,
          organizationId
        }
      });

      if (!row) {
        res.status(404).json({ success: false, message: 'Customer not found' });
        return;
      }

      res.json({
        success: true,
        data: {
          id: row.id,
          name: row.displayName || 'Customer',
          phone: row.phoneNumber,
          address: row.shippingAddress,
          notes: row.notes,
          totalOrders: row.totalOrders,
          totalSpend: Number(row.totalSpend),
          lastContactAt: row.lastContactAt.toISOString(),
          createdAt: row.createdAt.toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/v1/customers/:id
   * Updates customer profile fields with validation and strict tenant scoping.
   */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string;
      const organizationId = req.organizationId || 'org_default';
      const { name, displayName, address, shippingAddress, notes } = req.body;

      const data: Prisma.CustomerUpdateInput = {};

      if (name !== undefined || displayName !== undefined) {
        data.displayName = (name || displayName || '').trim() || null;
      }
      if (address !== undefined || shippingAddress !== undefined) {
        data.shippingAddress = (address || shippingAddress || '').trim() || null;
      }
      if (notes !== undefined) {
        data.notes = (notes || '').trim() || null;
      }

      if (Object.keys(data).length === 0) {
        res.status(400).json({ success: false, message: 'No valid fields provided for update' });
        return;
      }

      const resUpdate = await prisma.customer.updateMany({
        where: {
          id,
          organizationId
        },
        data
      });

      if (resUpdate.count === 0) {
        res.status(404).json({ success: false, message: 'Customer not found or update failed' });
        return;
      }

      const updated = await prisma.customer.findUniqueOrThrow({
        where: { id }
      });

      res.json({
        success: true,
        message: 'Customer updated successfully',
        data: {
          id: updated.id,
          name: updated.displayName || 'Customer',
          phone: updated.phoneNumber,
          address: updated.shippingAddress,
          notes: updated.notes,
          totalOrders: updated.totalOrders,
          totalSpend: Number(updated.totalSpend),
          lastContactAt: updated.lastContactAt.toISOString(),
          createdAt: updated.createdAt.toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }
};
