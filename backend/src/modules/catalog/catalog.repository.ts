import { supabase } from '../../core/database/supabase.js';
import {
  JerseyRecord,
  JerseyInventoryRecord,
  CreateJerseyDTO,
  UpdateJerseyDTO,
  CatalogFilterDTO,
  PaginatedResult,
  JerseySize
} from './catalog.types.js';

export const catalogRepository = {
  /**
   * Retrieves a paginated list of jerseys with their size inventories.
   */
  async listJerseys(
    organizationId: string,
    filter: CatalogFilterDTO
  ): Promise<PaginatedResult<JerseyRecord>> {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('jerseys')
      .select('*, jersey_inventory(*)', { count: 'exact' })
      .eq('organization_id', organizationId);

    if (filter.league) {
      query = query.ilike('league', `%${filter.league}%`);
    }
    if (filter.team) {
      query = query.ilike('team', `%${filter.team}%`);
    }
    if (filter.season) {
      query = query.eq('season', filter.season);
    }
    if (filter.kitType) {
      query = query.ilike('kit_type', `%${filter.kitType}%`);
    }
    if (filter.search) {
      // Remove all characters except alphanumeric, whitespace, and hyphens to prevent PostgREST syntax injection
      const sanitized = filter.search.replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
      if (sanitized) {
        query = query.or(`title.ilike.%${sanitized}%,team.ilike.%${sanitized}%,league.ilike.%${sanitized}%`);
      }
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    const total = count || 0;
    const formatted: JerseyRecord[] = (data || []).map((row: any) => ({
      id: row.id,
      organizationId: row.organization_id,
      discoveredKitId: row.discovered_kit_id,
      title: row.title,
      league: row.league,
      team: row.team,
      season: row.season,
      kitType: row.kit_type,
      basePrice: Number(row.base_price),
      imageUrl: row.image_url,
      description: row.description,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      inventory: (row.jersey_inventory || []).map((inv: any) => ({
        id: inv.id,
        organizationId: inv.organization_id,
        jerseyId: inv.jersey_id,
        size: inv.size as JerseySize,
        quantityOnHand: inv.quantity_on_hand,
        quantityReserved: inv.quantity_reserved,
        quantityAvailable: inv.quantity_on_hand - inv.quantity_reserved,
        updatedAt: inv.updated_at
      }))
    }));

    // Optional post-filtering for inStock / specific size
    let resultData = formatted;
    if (filter.size) {
      resultData = resultData.filter((j) =>
        j.inventory?.some((inv) => inv.size === filter.size && inv.quantityAvailable > 0)
      );
    } else if (filter.inStock === true) {
      resultData = resultData.filter((j) =>
        j.inventory?.some((inv) => inv.quantityAvailable > 0)
      );
    }

    return {
      data: resultData,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  },

  /**
   * Retrieves a single jersey with full size inventory.
   */
  async getJerseyById(organizationId: string, id: string): Promise<JerseyRecord | null> {
    const { data, error } = await supabase
      .from('jerseys')
      .select('*, jersey_inventory(*)')
      .eq('organization_id', organizationId)
      .eq('id', id)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      organizationId: data.organization_id,
      discoveredKitId: data.discovered_kit_id,
      title: data.title,
      league: data.league,
      team: data.team,
      season: data.season,
      kitType: data.kit_type,
      basePrice: Number(data.base_price),
      imageUrl: data.image_url,
      description: data.description,
      isActive: data.is_active,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      inventory: (data.jersey_inventory || []).map((inv: any) => ({
        id: inv.id,
        organizationId: inv.organization_id,
        jerseyId: inv.jersey_id,
        size: inv.size as JerseySize,
        quantityOnHand: inv.quantity_on_hand,
        quantityReserved: inv.quantity_reserved,
        quantityAvailable: inv.quantity_on_hand - inv.quantity_reserved,
        updatedAt: inv.updated_at
      }))
    };
  },

  /**
   * Inserts a new jersey and seeds its initial inventory records.
   */
  async createJersey(organizationId: string, dto: CreateJerseyDTO): Promise<JerseyRecord> {
    const { data, error } = await supabase
      .from('jerseys')
      .insert({
        organization_id: organizationId,
        title: dto.title,
        league: dto.league,
        team: dto.team,
        season: dto.season,
        kit_type: dto.kitType,
        base_price: dto.basePrice,
        image_url: dto.imageUrl,
        description: dto.description || null,
        discovered_kit_id: dto.discoveredKitId || null,
        is_active: true
      })
      .select()
      .single();

    if (error || !data) throw error;

    const standardSizes: JerseySize[] = ['S', 'M', 'L', 'XL', 'XXL'];
    const inventoryRows = standardSizes.map((size) => ({
      organization_id: organizationId,
      jersey_id: data.id,
      size,
      quantity_on_hand: dto.initialStock?.[size] ?? 0,
      quantity_reserved: 0
    }));

    const { data: invData, error: invError } = await supabase
      .from('jersey_inventory')
      .insert(inventoryRows)
      .select();

    if (invError) throw invError;

    return {
      id: data.id,
      organizationId: data.organization_id,
      discoveredKitId: data.discovered_kit_id,
      title: data.title,
      league: data.league,
      team: data.team,
      season: data.season,
      kitType: data.kit_type,
      basePrice: Number(data.base_price),
      imageUrl: data.image_url,
      description: data.description,
      isActive: data.is_active,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      inventory: (invData || []).map((inv: any) => ({
        id: inv.id,
        organizationId: inv.organization_id,
        jerseyId: inv.jersey_id,
        size: inv.size as JerseySize,
        quantityOnHand: inv.quantity_on_hand,
        quantityReserved: inv.quantity_reserved,
        quantityAvailable: inv.quantity_on_hand - inv.quantity_reserved,
        updatedAt: inv.updated_at
      }))
    };
  },

  /**
   * Updates general details of a jersey.
   */
  async updateJersey(
    organizationId: string,
    id: string,
    dto: UpdateJerseyDTO
  ): Promise<JerseyRecord | null> {
    const updates: any = {};
    if (dto.title !== undefined) updates.title = dto.title;
    if (dto.basePrice !== undefined) updates.base_price = dto.basePrice;
    if (dto.imageUrl !== undefined) updates.image_url = dto.imageUrl;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.isActive !== undefined) updates.is_active = dto.isActive;

    const { data, error } = await supabase
      .from('jerseys')
      .update(updates)
      .eq('organization_id', organizationId)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) return null;
    return this.getJerseyById(organizationId, id);
  },

  /**
   * Adjusts stock quantity for a size and writes an immutable entry to inventory_movements.
   */
  async adjustInventory(
    organizationId: string,
    jerseyId: string,
    size: JerseySize,
    quantityDelta: number,
    actor = 'store_owner',
    reason = 'Manual adjustment'
  ): Promise<JerseyInventoryRecord> {
    // 1. Get current inventory record
    const { data: current, error: fetchErr } = await supabase
      .from('jersey_inventory')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('jersey_id', jerseyId)
      .eq('size', size)
      .single();

    if (fetchErr || !current) {
      throw new Error(`Inventory record not found for Jersey ${jerseyId} Size ${size}`);
    }

    const newOnHand = current.quantity_on_hand + quantityDelta;
    if (newOnHand < current.quantity_reserved) {
      throw new Error(
        `Cannot reduce stock to ${newOnHand}; ${current.quantity_reserved} units are currently reserved for pending orders`
      );
    }
    if (newOnHand < 0) {
      throw new Error(`Quantity on hand cannot be negative (Calculated: ${newOnHand})`);
    }

    // 2. Update stock level
    const { data: updated, error: updateErr } = await supabase
      .from('jersey_inventory')
      .update({
        quantity_on_hand: newOnHand,
        updated_at: new Date().toISOString()
      })
      .eq('id', current.id)
      .select()
      .single();

    if (updateErr || !updated) throw updateErr;

    // 3. Record in audit ledger
    await supabase.from('inventory_movements').insert({
      organization_id: organizationId,
      jersey_id: jerseyId,
      size,
      movement_type: quantityDelta > 0 ? 'restock' : 'manual_adjustment',
      quantity_delta: quantityDelta,
      quantity_on_hand_before: current.quantity_on_hand,
      quantity_on_hand_after: newOnHand,
      quantity_reserved_before: current.quantity_reserved,
      quantity_reserved_after: current.quantity_reserved,
      actor,
      reason
    });

    return {
      id: updated.id,
      organizationId: updated.organization_id,
      jerseyId: updated.jersey_id,
      size: updated.size as JerseySize,
      quantityOnHand: updated.quantity_on_hand,
      quantityReserved: updated.quantity_reserved,
      quantityAvailable: updated.quantity_on_hand - updated.quantity_reserved,
      updatedAt: updated.updated_at
    };
  },

  /**
   * Deactivates a jersey.
   */
  async deleteJersey(organizationId: string, id: string): Promise<boolean> {
    const { error } = await supabase
      .from('jerseys')
      .update({ is_active: false })
      .eq('organization_id', organizationId)
      .eq('id', id);

    return !error;
  }
};
