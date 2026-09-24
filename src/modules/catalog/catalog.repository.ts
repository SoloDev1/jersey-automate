import { prisma } from '../../core/database/prisma.js';
import { Prisma } from '@prisma/client';
import {
  JerseyRecord,
  JerseyInventoryRecord,
  CreateJerseyDTO,
  UpdateJerseyDTO,
  CatalogFilterDTO,
  PaginatedResult,
  JerseySize
} from './catalog.types.js';

// Fully-typed payload with included inventory relation - zero `any`
type JerseyWithInventory = Prisma.JerseyGetPayload<{
  include: { inventory: true };
}>;

// Common team name alias lookup for fans typing shortcuts
const CLUB_ALIASES: Record<string, string> = {
  manu: 'Manchester United',
  'man u': 'Manchester United',
  'man utd': 'Manchester United',
  united: 'Manchester United',
  'red devils': 'Manchester United',
  'man city': 'Manchester City',
  mancity: 'Manchester City',
  city: 'Manchester City',
  citizens: 'Manchester City',
  arsenal: 'Arsenal',
  gunners: 'Arsenal',
  chelsea: 'Chelsea',
  blues: 'Chelsea',
  liverpool: 'Liverpool',
  reds: 'Liverpool',
  spurs: 'Tottenham Hotspur',
  tottenham: 'Tottenham Hotspur',
  madrid: 'Real Madrid',
  'real madrid': 'Real Madrid',
  barca: 'Barcelona',
  barcelona: 'Barcelona',
  juve: 'Juventus',
  juventus: 'Juventus',
  milan: 'AC Milan',
  'ac milan': 'AC Milan',
  inter: 'Inter Milan',
  'inter milan': 'Inter Milan',
  bayern: 'Bayern Munich',
  'bayern munich': 'Bayern Munich',
  bvb: 'Borussia Dortmund',
  dortmund: 'Borussia Dortmund',
  psg: 'Paris Saint-Germain',
  'paris saint-germain': 'Paris Saint-Germain',
  wolves: 'Wolverhampton Wanderers',
  newcastle: 'Newcastle United',
  villa: 'Aston Villa',
  'aston villa': 'Aston Villa'
};

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolves fan nicknames and slang into standard club names.
 */
export function normalizeTeamName(term?: string): string {
  if (!term) return '';
  const trimmed = term.trim();
  const lower = trimmed.toLowerCase();
  if (CLUB_ALIASES[lower]) return CLUB_ALIASES[lower];
  for (const [alias, standardName] of Object.entries(CLUB_ALIASES)) {
    const escaped = escapeRegex(alias);
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(lower)) {
      return standardName;
    }
  }
  return trimmed;
}

/**
 * Maps a strongly-typed Prisma Jersey entity with inventory to the domain JerseyRecord.
 */
function mapJerseyToRecord(row: JerseyWithInventory): JerseyRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    discoveredKitId: row.discoveredKitId,
    title: row.title,
    league: row.league,
    team: row.team,
    season: row.season,
    kitType: row.kitType,
    basePrice: Number(row.basePrice),
    imageUrl: row.imageUrl,
    description: row.description,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    inventory: row.inventory.map((inv) => ({
      id: inv.id,
      organizationId: inv.organizationId,
      jerseyId: inv.jerseyId,
      size: inv.size as JerseySize,
      quantityOnHand: inv.quantityOnHand,
      quantityReserved: inv.quantityReserved,
      quantityAvailable: inv.quantityOnHand - inv.quantityReserved,
      updatedAt: inv.updatedAt.toISOString()
    }))
  };
}

// Row shape returned by PostgreSQL SELECT ... FOR UPDATE
interface LockedInventoryRow {
  id: string;
  organization_id: string;
  jersey_id: string;
  size: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  updated_at: Date;
}

export const catalogRepository = {
  /**
   * Retrieves a paginated list of jerseys with their size inventories using Prisma.
   * All filtering (including size and inStock) occurs in the database WHERE clause
   * to guarantee strictly accurate pagination counts.
   */
  async listJerseys(
    organizationId: string,
    filter: CatalogFilterDTO
  ): Promise<PaginatedResult<JerseyRecord>> {
    // 1. Sanitize & clamp pagination bounds
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filter.limit) || 20));
    const offset = (page - 1) * limit;

    // 2. Build typed Prisma WHERE clause
    const where: Prisma.JerseyWhereInput = {
      organizationId,
      isActive: true
    };

    if (filter.league) {
      where.league = { contains: filter.league, mode: 'insensitive' };
    }

    if (filter.team) {
      const normalized = normalizeTeamName(filter.team);
      where.team = { contains: normalized, mode: 'insensitive' };
    }

    if (filter.season) {
      where.season = filter.season;
    }

    if (filter.kitType) {
      const normalizedType =
        filter.kitType.charAt(0).toUpperCase() + filter.kitType.slice(1).toLowerCase();
      where.kitType = { equals: normalizedType, mode: 'insensitive' };
    }

    // Push size and inStock filters directly into database WHERE clause
    if (filter.size) {
      where.inventory = {
        some: {
          size: filter.size,
          ...(filter.inStock !== false ? { quantityOnHand: { gt: 0 } } : {})
        }
      };
    } else if (filter.inStock === true) {
      where.inventory = {
        some: {
          quantityOnHand: { gt: 0 }
        }
      };
    }

    // Multi-token and alias-aware search
    if (filter.search) {
      const sanitized = filter.search.replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
      if (sanitized) {
        const tokens = sanitized.split(' ').filter(Boolean);
        const resolvedTeam = normalizeTeamName(sanitized);

        const searchConditions: Prisma.JerseyWhereInput[] = [
          { title: { contains: sanitized, mode: 'insensitive' } },
          { league: { contains: sanitized, mode: 'insensitive' } }
        ];

        if (resolvedTeam && resolvedTeam !== sanitized) {
          searchConditions.push({ team: { contains: resolvedTeam, mode: 'insensitive' } });
        } else {
          searchConditions.push({ team: { contains: sanitized, mode: 'insensitive' } });
        }

        // Token matching for multi-word queries like "Arsenal home 2025"
        if (tokens.length > 1) {
          for (const token of tokens) {
            const resolvedToken = normalizeTeamName(token);
            searchConditions.push(
              { title: { contains: token, mode: 'insensitive' } },
              { team: { contains: resolvedToken || token, mode: 'insensitive' } }
            );
          }
        }

        where.OR = searchConditions;
      }
    }

    // 3. Concurrently fetch rows and count in database
    const [rows, total] = await Promise.all([
      prisma.jersey.findMany({
        where,
        include: { inventory: true },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.jersey.count({ where })
    ]);

    const formatted = rows.map(mapJerseyToRecord);

    return {
      data: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit)
      }
    };
  },

  /**
   * Retrieves a single jersey by its UUID with full size inventories.
   */
  async getJerseyById(organizationId: string, id: string): Promise<JerseyRecord | null> {
    const row = await prisma.jersey.findFirst({
      where: {
        id,
        organizationId
      },
      include: {
        inventory: true
      }
    });

    if (!row) return null;
    return mapJerseyToRecord(row);
  },

  /**
   * Inserts a new jersey and seeds its initial inventory records inside an ACID transaction.
   */
  async createJersey(organizationId: string, dto: CreateJerseyDTO): Promise<JerseyRecord> {
    const standardSizes: JerseySize[] = ['S', 'M', 'L', 'XL', 'XXL'];

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Jersey record
      const jersey = await tx.jersey.create({
        data: {
          organizationId,
          title: dto.title,
          league: dto.league,
          team: dto.team,
          season: dto.season,
          kitType: dto.kitType,
          basePrice: dto.basePrice,
          imageUrl: dto.imageUrl,
          description: dto.description || null,
          discoveredKitId: dto.discoveredKitId || null,
          isActive: true
        }
      });

      // 2. Seed default size inventories
      await tx.jerseyInventory.createMany({
        data: standardSizes.map((size) => ({
          organizationId,
          jerseyId: jersey.id,
          size,
          quantityOnHand: dto.initialStock?.[size] ?? 0,
          quantityReserved: 0
        }))
      });

      // 3. Return newly created jersey with all inventory rows
      return tx.jersey.findUniqueOrThrow({
        where: { id: jersey.id },
        include: { inventory: true }
      });
    });

    return mapJerseyToRecord(result);
  },

  /**
   * Updates general details of a jersey.
   * Rejects empty payloads and verifies record existence.
   */
  async updateJersey(
    organizationId: string,
    id: string,
    dto: UpdateJerseyDTO
  ): Promise<JerseyRecord | null> {
    const data: Prisma.JerseyUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.basePrice !== undefined) data.basePrice = dto.basePrice;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (Object.keys(data).length === 0) {
      throw new Error('No valid fields provided for update');
    }

    const res = await prisma.jersey.updateMany({
      where: {
        id,
        organizationId
      },
      data
    });

    if (res.count === 0) {
      return null;
    }

    return this.getJerseyById(organizationId, id);
  },

  /**
   * Adjusts stock quantity for a size and records an immutable entry in inventory_movements.
   * Uses PostgreSQL `SELECT ... FOR UPDATE` row-level locking to guarantee zero race conditions.
   */
  async adjustInventory(
    organizationId: string,
    jerseyId: string,
    size: JerseySize,
    quantityDelta: number,
    actor = 'store_owner',
    reason = 'Manual adjustment'
  ): Promise<JerseyInventoryRecord> {
    return prisma.$transaction(async (tx) => {
      // 1. Pessimistic Row Lock: Lock the exact inventory row to serialize concurrent writes
      const lockedRows = await tx.$queryRaw<LockedInventoryRow[]>`
        SELECT id, organization_id, jersey_id, size, quantity_on_hand, quantity_reserved, updated_at
        FROM jersey_inventory
        WHERE organization_id = ${organizationId}
          AND jersey_id = ${jerseyId}::uuid
          AND size = ${size}
        FOR UPDATE;
      `;

      const current = lockedRows[0];
      if (!current) {
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
      const updated = await tx.jerseyInventory.update({
        where: { id: current.id },
        data: { quantityOnHand: newOnHand }
      });

      // 3. Record in immutable audit ledger
      await tx.inventoryMovement.create({
        data: {
          organizationId,
          jerseyId,
          size,
          movementType: quantityDelta > 0 ? 'restock' : 'manual_adjustment',
          quantityDelta,
          quantityOnHandBefore: current.quantity_on_hand,
          quantityOnHandAfter: newOnHand,
          quantityReservedBefore: current.quantity_reserved,
          quantityReservedAfter: current.quantity_reserved,
          actor,
          reason
        }
      });

      return {
        id: updated.id,
        organizationId: updated.organizationId,
        jerseyId: updated.jerseyId,
        size: updated.size as JerseySize,
        quantityOnHand: updated.quantityOnHand,
        quantityReserved: updated.quantityReserved,
        quantityAvailable: updated.quantityOnHand - updated.quantityReserved,
        updatedAt: updated.updatedAt.toISOString()
      };
    });
  },

  /**
   * Deactivates a jersey (soft delete).
   */
  async deleteJersey(organizationId: string, id: string): Promise<boolean> {
    const res = await prisma.jersey.updateMany({
      where: {
        id,
        organizationId
      },
      data: { isActive: false }
    });

    return res.count > 0;
  }
};
