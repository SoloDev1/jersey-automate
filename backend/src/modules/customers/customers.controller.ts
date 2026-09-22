import { Request, Response, NextFunction } from 'express';
import { supabase } from '../../core/database/supabase.js';

export const customersController = {
  /**
   * GET /api/v1/customers
   * Lists customers for the organization with search and pagination
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const search = req.query.search as string | undefined;
      const organizationId = req.organizationId;

      let query = supabase
        .from('customers')
        .select('*', { count: 'exact' })
        .eq('organization_id', organizationId)
        .order('last_contact_at', { ascending: false });

      if (search && search.trim()) {
        const term = `%${search.trim()}%`;
        query = query.or(`display_name.ilike.${term},phone_number.ilike.${term}`);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      res.json({
        success: true,
        data: (data || []).map((row) => ({
          id: row.id,
          name: row.display_name || 'Customer',
          phone: row.phone_number,
          address: row.shipping_address,
          notes: row.notes,
          totalOrders: row.total_orders || 0,
          totalSpend: Number(row.total_spend) || 0,
          lastContactAt: row.last_contact_at,
          createdAt: row.created_at,
        })),
        total: count || 0,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/customers/:id
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = req.organizationId;

      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('id', id)
        .single();

      if (error || !data) {
        res.status(404).json({ success: false, message: 'Customer not found' });
        return;
      }

      res.json({
        success: true,
        data: {
          id: data.id,
          name: data.display_name || 'Customer',
          phone: data.phone_number,
          address: data.shipping_address,
          notes: data.notes,
          totalOrders: data.total_orders || 0,
          totalSpend: Number(data.total_spend) || 0,
          lastContactAt: data.last_contact_at,
          createdAt: data.created_at,
        },
      });
    } catch (error) {
      next(error);
    }
  },
};
