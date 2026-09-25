import { prisma } from '../../core/database/prisma.js';
import { Prisma } from '@prisma/client';
import { formatPhoneNumber } from '../../core/utils/phoneFormatter.js';
import {
  OrderRecord,
  OrderItemRecord,
  CreateOrderDTO,
  UpdateOrderStatusDTO,
  OrderFilterDTO,
  PaymentStatus,
  FulfillmentStatus,
  UpdateOrderAddressInput,
  UpdateOrderAddressResult
} from './orders.types.js';
import { JerseySize, PaginatedResult } from '../catalog/catalog.types.js';

// Fully-typed payload with joined customer and order items - zero `any`
type OrderWithRelations = Prisma.OrderGetPayload<{
  include: {
    customer: {
      select: {
        phoneNumber: true;
        displayName: true;
      };
    };
    orderItems: {
      include: {
        jersey: {
          select: {
            title: true;
            imageUrl: true;
          };
        };
      };
    };
  };
}>;

interface LockedStockRow {
  id: string;
  quantity_on_hand: number;
  quantity_reserved: number;
}

/**
 * Transforms a Prisma order entity with relations to the domain OrderRecord.
 */
function mapOrderToRecord(row: OrderWithRelations): OrderRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    orderNumber: row.orderNumber,
    customerId: row.customerId,
    subtotal: Number(row.subtotal),
    shippingFee: Number(row.shippingFee),
    totalAmount: Number(row.totalAmount),
    currency: row.currency,
    paymentStatus: row.paymentStatus as PaymentStatus,
    fulfillmentStatus: row.fulfillmentStatus as FulfillmentStatus,
    paystackReference: row.paystackReference,
    paystackAccessCode: row.paystackAccessCode,
    paymentUrl: row.paymentUrl,
    reservationExpiresAt: row.reservationExpiresAt ? row.reservationExpiresAt.toISOString() : null,
    shippingAddress: row.shippingAddress,
    shippingTrackingNumber: row.shippingTrackingNumber,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    customerPhone: row.customer?.phoneNumber,
    customerName: row.customer?.displayName ?? undefined,
    items: (row.orderItems || []).map((item) => ({
      id: item.id,
      orderId: item.orderId,
      jerseyId: item.jerseyId,
      size: item.size as JerseySize,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      customName: item.customName,
      customNumber: item.customNumber,
      printingFee: Number(item.printingFee),
      createdAt: item.createdAt.toISOString(),
      jerseyTitle: item.jersey?.title,
      jerseyImage: item.jersey?.imageUrl
    }))
  };
}

export const ordersRepository = {
  /**
   * Concurrency-safe atomic find-or-create customer using database-level UPSERT.
   * Backed by PostgreSQL @@unique([organizationId, phoneNumber]).
   */
  async findOrCreateCustomer(
    organizationId: string,
    phoneNumber: string,
    displayName?: string
  ): Promise<{ id: string; phoneNumber: string; displayName: string | null }> {
    const normalizedPhone = formatPhoneNumber(phoneNumber);
    const customer = await prisma.customer.upsert({
      where: {
        uq_customer_org_phone: {
          organizationId,
          phoneNumber: normalizedPhone
        }
      },
      update: displayName ? { displayName } : {},
      create: {
        organizationId,
        phoneNumber: normalizedPhone,
        displayName: displayName || null
      },
      select: {
        id: true,
        phoneNumber: true,
        displayName: true
      }
    });

    return customer;
  },

  /**
   * Retrieves organization store settings (fees, currency).
   */
  async getStoreSettings(organizationId: string) {
    const data = await prisma.setting.findUnique({
      where: { organizationId }
    });

    return {
      currency: data?.currency || 'NGN',
      shippingFee: Number(data?.defaultShippingFee ?? 2000),
      printingFee: Number(data?.customPrintingFee ?? 3000)
    };
  },

  /**
   * Creates an order, order items, and executes atomic stock reservation.
   * Total price is calculated strictly on the server from jerseys and settings.
   * Uses PostgreSQL pessimistic row locking (SELECT ... FOR UPDATE) to eliminate race conditions.
   * Entire operation is ACID compliant inside a single Prisma interactive transaction.
   */
  async createOrderWithReservation(
    organizationId: string,
    dto: CreateOrderDTO,
    ttlMinutes = 15
  ): Promise<OrderRecord> {
    const t0 = performance.now();

    // 1. Resolve or create customer atomically OUTSIDE the lock transaction
    const tCustomerStart = performance.now();
    const normalizedPhone = formatPhoneNumber(dto.customerPhone);
    const customer = await prisma.customer.upsert({
      where: {
        uq_customer_org_phone: {
          organizationId,
          phoneNumber: normalizedPhone
        }
      },
      update: dto.customerName ? { displayName: dto.customerName } : {},
      create: {
        organizationId,
        phoneNumber: normalizedPhone,
        displayName: dto.customerName || null
      },
      select: { id: true, phoneNumber: true, displayName: true }
    });
    const tCustomerEnd = performance.now();

    // 2. Fetch store settings OUTSIDE the lock transaction
    const tSettingsStart = performance.now();
    const settings = await prisma.setting.findUnique({
      where: { organizationId }
    });
    const currency = settings?.currency || 'NGN';
    const shippingFee = Number(settings?.defaultShippingFee ?? 2000);
    const printingFeePerItem = Number(settings?.customPrintingFee ?? 3000);
    const tSettingsEnd = performance.now();

    // 3. Fetch active jerseys to verify pricing and availability OUTSIDE the lock transaction
    const tCatalogStart = performance.now();
    const jerseyIds = Array.from(new Set(dto.items.map((i) => i.jerseyId)));
    const jerseys = await prisma.jersey.findMany({
      where: {
        id: { in: jerseyIds },
        organizationId
      },
      select: {
        id: true,
        title: true,
        imageUrl: true,
        basePrice: true,
        isActive: true
      }
    });

    const jerseyMap = new Map(jerseys.map((j) => [j.id, j]));
    const tCatalogEnd = performance.now();

    // 4. Calculate pricing and validate line items
    let subtotal = 0;
    const preparedItems = dto.items.map((item) => {
      const jersey = jerseyMap.get(item.jerseyId);
      if (!jersey || !jersey.isActive) {
        throw new Error(`Jersey ${item.jerseyId} is not available for purchase`);
      }

      const unitPrice = Number(jersey.basePrice);
      const hasCustomization = Boolean(item.customName || item.customNumber);
      const printingFee = hasCustomization ? printingFeePerItem : 0;
      const itemTotal = (unitPrice + printingFee) * item.quantity;
      subtotal += itemTotal;

      return {
        jerseyId: item.jerseyId,
        jerseyTitle: jersey.title,
        size: item.size,
        quantity: item.quantity,
        unitPrice,
        customName: item.customName || null,
        customNumber: item.customNumber || null,
        printingFee
      };
    });

    const totalAmount = subtotal + shippingFee;
    const reservationExpiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    console.log(
      `[createOrderWithReservation] Pre-flight timings: customer=${(tCustomerEnd - tCustomerStart).toFixed(1)}ms, settings=${(tSettingsEnd - tSettingsStart).toFixed(1)}ms, catalog=${(tCatalogEnd - tCatalogStart).toFixed(1)}ms. Total pre-flight: ${(performance.now() - t0).toFixed(1)}ms. Starting atomic transaction...`
    );

    // 5. Atomic Interactive Transaction strictly for inventory locking and order creation
    const tTxStart = performance.now();
    const orderRecord = await prisma.$transaction(
      async (tx) => {
        // Sort items to guarantee consistent lock acquisition order and prevent deadlocks
        const sortedItems = [...preparedItems].sort((a, b) =>
          a.jerseyId === b.jerseyId ? a.size.localeCompare(b.size) : a.jerseyId.localeCompare(b.jerseyId)
        );

        const lockedInventories = new Map<string, LockedStockRow>();

        const tLockStart = performance.now();
        for (const item of sortedItems) {
          const key = `${item.jerseyId}:${item.size}`;
          if (!lockedInventories.has(key)) {
            const lockedRows = await tx.$queryRaw<LockedStockRow[]>`
              SELECT id, quantity_on_hand, quantity_reserved
              FROM jersey_inventory
              WHERE organization_id = ${organizationId}
                AND jersey_id = ${item.jerseyId}::uuid
                AND size = ${item.size}
              FOR UPDATE;
            `;

            if (!lockedRows || lockedRows.length === 0) {
              throw new Error(`Inventory row not found for jersey "${item.jerseyTitle}" (${item.size})`);
            }

            lockedInventories.set(key, { ...lockedRows[0] });
          }

          const currentInv = lockedInventories.get(key)!;
          const available = currentInv.quantity_on_hand - currentInv.quantity_reserved;

          if (available < item.quantity) {
            throw new Error(
              `Insufficient stock for "${item.jerseyTitle}" (Size ${item.size}). Requested: ${item.quantity}, Available: ${available}`
            );
          }

          // Increment reserved quantity in our local tracker for multi-item validation
          currentInv.quantity_reserved += item.quantity;
        }
        const tLockEnd = performance.now();

        // Create pending order row
        const tOrderCreateStart = performance.now();
        const order = await tx.order.create({
          data: {
            organizationId,
            customerId: customer.id,
            subtotal,
            shippingFee,
            totalAmount,
            currency,
            paymentStatus: 'pending',
            fulfillmentStatus: 'unfulfilled',
            reservationExpiresAt,
            shippingAddress: dto.shippingAddress || null,
            notes: dto.notes || null
          }
        });
        const tOrderCreateEnd = performance.now();

        // Insert order items, stock reservations, and inventory movements
        const tItemsStart = performance.now();
        const createdItems: OrderItemRecord[] = [];

        for (const item of preparedItems) {
          const orderItem = await tx.orderItem.create({
            data: {
              orderId: order.id,
              jerseyId: item.jerseyId,
              size: item.size,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              customName: item.customName,
              customNumber: item.customNumber,
              printingFee: item.printingFee
            }
          });

          const reservation = await tx.stockReservation.create({
            data: {
              organizationId,
              orderId: order.id,
              orderItemId: orderItem.id,
              jerseyId: item.jerseyId,
              size: item.size,
              quantity: item.quantity,
              status: 'active',
              expiresAt: reservationExpiresAt
            }
          });

          const key = `${item.jerseyId}:${item.size}`;
          const inv = lockedInventories.get(key)!;

          // Apply reservation increment to DB
          await tx.jerseyInventory.update({
            where: { id: inv.id },
            data: { quantityReserved: { increment: item.quantity } }
          });

          // Audit inventory hold in movement log
          await tx.inventoryMovement.create({
            data: {
              organizationId,
              jerseyId: item.jerseyId,
              size: item.size,
              movementType: 'reserve',
              quantityDelta: item.quantity,
              quantityOnHandBefore: inv.quantity_on_hand,
              quantityOnHandAfter: inv.quantity_on_hand,
              quantityReservedBefore: inv.quantity_reserved - item.quantity,
              quantityReservedAfter: inv.quantity_reserved,
              orderId: order.id,
              reservationId: reservation.id,
              actor: 'orders_service',
              reason: `Order #${order.orderNumber} stock reservation`
            }
          });

          const jersey = jerseyMap.get(item.jerseyId);
          createdItems.push({
            id: orderItem.id,
            orderId: order.id,
            jerseyId: item.jerseyId,
            size: item.size,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            customName: item.customName,
            customNumber: item.customNumber,
            printingFee: item.printingFee,
            createdAt: orderItem.createdAt.toISOString(),
            jerseyTitle: jersey?.title,
            jerseyImage: jersey?.imageUrl ? jersey.imageUrl : undefined
          });
        }
        const tItemsEnd = performance.now();

        console.log(
          `[createOrderWithReservation] Transaction timings: lock=${(tLockEnd - tLockStart).toFixed(1)}ms, orderCreate=${(tOrderCreateEnd - tOrderCreateStart).toFixed(1)}ms, itemsReservation=${(tItemsEnd - tItemsStart).toFixed(1)}ms`
        );

        // Assemble OrderRecord directly without redundant reload query
        const record: OrderRecord = {
          id: order.id,
          organizationId: order.organizationId,
          orderNumber: order.orderNumber,
          customerId: order.customerId,
          subtotal: Number(order.subtotal),
          shippingFee: Number(order.shippingFee),
          totalAmount: Number(order.totalAmount),
          currency: order.currency,
          paymentStatus: order.paymentStatus as PaymentStatus,
          fulfillmentStatus: order.fulfillmentStatus as FulfillmentStatus,
          paystackReference: order.paystackReference,
          paystackAccessCode: order.paystackAccessCode,
          paymentUrl: order.paymentUrl,
          reservationExpiresAt: order.reservationExpiresAt ? order.reservationExpiresAt.toISOString() : null,
          shippingAddress: order.shippingAddress,
          shippingTrackingNumber: order.shippingTrackingNumber,
          notes: order.notes,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
          customerPhone: customer.phoneNumber,
          customerName: customer.displayName ?? undefined,
          items: createdItems
        };

        return record;
      },
      {
        maxWait: 10000,
        timeout: 20000
      }
    );

    const tEnd = performance.now();
    console.log(
      `[createOrderWithReservation] Order #${orderRecord.orderNumber} created successfully in ${(tEnd - t0).toFixed(1)}ms (DB tx: ${(tEnd - tTxStart).toFixed(1)}ms)`
    );

    return orderRecord;
  },

  /**
   * Fetches an order with all items and customer details.
   */
  async getOrderById(organizationId: string, id: string): Promise<OrderRecord | null> {
    const row = await prisma.order.findFirst({
      where: {
        id,
        organizationId
      },
      include: {
        customer: {
          select: {
            phoneNumber: true,
            displayName: true
          }
        },
        orderItems: {
          include: {
            jersey: {
              select: {
                title: true,
                imageUrl: true
              }
            }
          }
        }
      }
    });

    if (!row) return null;
    return mapOrderToRecord(row);
  },

  /**
   * Fetches an order by its Paystack reference.
   * Scoped to tenant organizationId when available.
   */
  async getOrderByPaystackRef(
    paystackReference: string,
    organizationId?: string
  ): Promise<OrderRecord | null> {
    const row = await prisma.order.findFirst({
      where: {
        paystackReference,
        ...(organizationId ? { organizationId } : {})
      },
      include: {
        customer: {
          select: {
            phoneNumber: true,
            displayName: true
          }
        },
        orderItems: {
          include: {
            jersey: {
              select: {
                title: true,
                imageUrl: true
              }
            }
          }
        }
      }
    });

    if (!row) return null;
    return mapOrderToRecord(row);
  },

  /**
   * Updates an order's Paystack payment initiation details.
   * Strictly tenant-scoped to organizationId.
   */
  async attachPaystackDetails(
    organizationId: string,
    orderId: string,
    paystackReference: string,
    accessCode: string,
    paymentUrl: string
  ): Promise<void> {
    await prisma.order.updateMany({
      where: {
        id: orderId,
        organizationId
      },
      data: {
        paystackReference,
        paystackAccessCode: accessCode,
        paymentUrl
      }
    });
  },

  /**
   * Marks an order as paid upon verified transaction confirmation.
   * Strictly tenant-scoped to organizationId.
   */
  async markOrderPaid(organizationId: string, orderId: string): Promise<void> {
    await prisma.order.updateMany({
      where: {
        id: orderId,
        organizationId
      },
      data: {
        paymentStatus: 'paid',
        fulfillmentStatus: 'printing'
      }
    });
  },

  /**
   * Updates fulfillment status or tracking number.
   */
  async updateStatus(
    organizationId: string,
    orderId: string,
    dto: UpdateOrderStatusDTO
  ): Promise<OrderRecord | null> {
    const data: Prisma.OrderUpdateInput = {};
    if (dto.fulfillmentStatus) data.fulfillmentStatus = dto.fulfillmentStatus;
    if (dto.shippingTrackingNumber !== undefined) data.shippingTrackingNumber = dto.shippingTrackingNumber;
    if (dto.notes !== undefined) data.notes = dto.notes;

    await prisma.order.updateMany({
      where: {
        id: orderId,
        organizationId
      },
      data
    });

    return this.getOrderById(organizationId, orderId);
  },

  /**
   * Lists orders with filters and pagination.
   */
  async listOrders(
    organizationId: string,
    filter: OrderFilterDTO
  ): Promise<PaginatedResult<OrderRecord>> {
    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filter.limit) || 20));
    const offset = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {
      organizationId
    };

    if (filter.paymentStatus) {
      where.paymentStatus = filter.paymentStatus;
    }
    if (filter.fulfillmentStatus) {
      where.fulfillmentStatus = filter.fulfillmentStatus;
    }
    if (filter.customerPhone) {
      const normalized = formatPhoneNumber(filter.customerPhone);
      where.customer = {
        phoneNumber: { contains: normalized }
      };
    }
    if (filter.search && filter.search.trim()) {
      const term = filter.search.trim();
      const orderNum = Number(term);
      where.OR = [
        ...(isNaN(orderNum) ? [] : [{ orderNumber: orderNum }]),
        { customer: { displayName: { contains: term, mode: 'insensitive' as const } } },
        { customer: { phoneNumber: { contains: term, mode: 'insensitive' as const } } }
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          customer: {
            select: {
              phoneNumber: true,
              displayName: true
            }
          },
          orderItems: {
            include: {
              jersey: {
                select: {
                  title: true,
                  imageUrl: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit
      }),
      prisma.order.count({ where })
    ]);

    return {
      data: rows.map(mapOrderToRecord),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit)
      }
    };
  },

  /**
   * Immediately releases any active stock reservation holds and cancels the order.
   * Invoked if payment gateway initialization fails or customer cancels checkout.
   * Completely atomic inside a PostgreSQL transaction with pessimistic row-level locking.
   */
  async cancelOrderAndReleaseStock(organizationId: string, orderId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // 0. State validation guard: do not allow cancelling paid orders
      const order = await tx.order.findFirst({
        where: {
          id: orderId,
          organizationId
        },
        select: {
          id: true,
          paymentStatus: true,
          fulfillmentStatus: true
        }
      });

      if (!order) {
        throw new Error(`Order ${orderId} not found in organization ${organizationId}`);
      }

      if (order.paymentStatus === 'paid') {
        throw new Error(`Cannot cancel order ${orderId}: Order is already paid.`);
      }

      if (order.fulfillmentStatus === 'cancelled') {
        return; // Idempotent exit if already cancelled
      }

      // 1. Fetch active reservations for this order
      const reservations = await tx.stockReservation.findMany({
        where: {
          organizationId,
          orderId,
          status: 'active'
        }
      });

      // 2. Lock and release inventory for each active reservation
      for (const res of reservations) {
        const lockedRows = await tx.$queryRaw<Array<{ id: string; quantity_on_hand: number; quantity_reserved: number }>>`
          SELECT id, quantity_on_hand, quantity_reserved
          FROM jersey_inventory
          WHERE organization_id = ${organizationId}
            AND jersey_id = ${res.jerseyId}::uuid
            AND size = ${res.size}
          FOR UPDATE;
        `;

        if (lockedRows && lockedRows.length > 0) {
          const inv = lockedRows[0];
          const newReserved = Math.max(0, inv.quantity_reserved - res.quantity);

          await tx.jerseyInventory.update({
            where: { id: inv.id },
            data: { quantityReserved: newReserved }
          });

          await tx.inventoryMovement.create({
            data: {
              organizationId,
              jerseyId: res.jerseyId,
              size: res.size,
              movementType: 'release',
              quantityDelta: -res.quantity,
              quantityOnHandBefore: inv.quantity_on_hand,
              quantityOnHandAfter: inv.quantity_on_hand,
              quantityReservedBefore: inv.quantity_reserved,
              quantityReservedAfter: newReserved,
              orderId,
              reservationId: res.id,
              actor: 'orders_service',
              reason: 'Order cancelled - release stock'
            }
          });
        }

        await tx.stockReservation.update({
          where: { id: res.id },
          data: {
            status: 'released',
            releasedAt: new Date()
          }
        });
      }

      // 3. Update order status to cancelled
      await tx.order.updateMany({
        where: {
          organizationId,
          id: orderId
        },
        data: {
          fulfillmentStatus: 'cancelled'
        }
      });
    });
  },

  /**
   * Releases stock reservations that have exceeded their 15-minute TTL without being paid.
   * Features:
   * 1. Distributed coordination via PostgreSQL advisory locking (safe for multi-replica clusters).
   * 2. Order-level transaction with FOR UPDATE row locking (prevents race with concurrent payment webhooks).
   * 3. Deterministic inventory lock ordering (jerseyId, size) to prevent lock-ordering deadlocks.
   */
  async releaseExpiredReservations(): Promise<number> {
    // 1. Acquire PostgreSQL advisory lock to guarantee only one replica runs cleanup across the cluster
    const lockResult = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_lock(739281) AS acquired;
    `;
    if (!lockResult || !lockResult[0]?.acquired) {
      return 0; // Another instance or replica is actively running cleanup
    }

    try {
      // 2. Identify candidate orders with expired, active reservations
      const expiredHolds = await prisma.stockReservation.findMany({
        where: {
          status: 'active',
          expiresAt: { lt: new Date() },
          order: {
            paymentStatus: { not: 'paid' }
          }
        },
        select: {
          orderId: true,
          organizationId: true
        },
        distinct: ['orderId'],
        take: 50
      });

      if (expiredHolds.length === 0) return 0;

      let releasedCount = 0;

      for (const hold of expiredHolds) {
        try {
          await prisma.$transaction(async (tx) => {
            // A. Row-lock order record to serialize against payment confirmation
            const lockedOrder = await tx.$queryRaw<Array<{ id: string; payment_status: string; fulfillment_status: string }>>`
              SELECT id, payment_status, fulfillment_status
              FROM orders
              WHERE id = ${hold.orderId}::uuid
                AND organization_id = ${hold.organizationId}
              FOR UPDATE;
            `;

            if (!lockedOrder || lockedOrder.length === 0) return;
            const order = lockedOrder[0];

            // If customer paid during this window, DO NOT release stock
            if (order.payment_status === 'paid') return;

            // B. Row-lock all active reservations for this order
            const lockedReservations = await tx.$queryRaw<Array<{ id: string; jersey_id: string; size: string; quantity: number }>>`
              SELECT id, jersey_id, size, quantity
              FROM stock_reservations
              WHERE order_id = ${hold.orderId}::uuid
                AND organization_id = ${hold.organizationId}
                AND status = 'active'
              FOR UPDATE;
            `;

            if (!lockedReservations || lockedReservations.length === 0) return;

            // C. Sort reservations deterministically (jersey_id, size) to prevent deadlock
            const sortedReservations = [...lockedReservations].sort((a, b) =>
              a.jersey_id === b.jersey_id ? a.size.localeCompare(b.size) : a.jersey_id.localeCompare(b.jersey_id)
            );

            // D. Lock inventory rows and release reserved holds
            for (const res of sortedReservations) {
              const lockedInventory = await tx.$queryRaw<Array<{ id: string; quantity_on_hand: number; quantity_reserved: number }>>`
                SELECT id, quantity_on_hand, quantity_reserved
                FROM jersey_inventory
                WHERE organization_id = ${hold.organizationId}
                  AND jersey_id = ${res.jersey_id}::uuid
                  AND size = ${res.size}
                FOR UPDATE;
              `;

              if (lockedInventory && lockedInventory.length > 0) {
                const inv = lockedInventory[0];
                const newReserved = Math.max(0, inv.quantity_reserved - res.quantity);

                await tx.jerseyInventory.update({
                  where: { id: inv.id },
                  data: { quantityReserved: newReserved }
                });

                await tx.inventoryMovement.create({
                  data: {
                    organizationId: hold.organizationId,
                    jerseyId: res.jersey_id,
                    size: res.size,
                    movementType: 'release',
                    quantityDelta: -res.quantity,
                    quantityOnHandBefore: inv.quantity_on_hand,
                    quantityOnHandAfter: inv.quantity_on_hand,
                    quantityReservedBefore: inv.quantity_reserved,
                    quantityReservedAfter: newReserved,
                    orderId: hold.orderId,
                    reservationId: res.id,
                    actor: 'reservation_cleanup_job',
                    reason: '15-minute reservation hold expired without payment'
                  }
                });
              }

              await tx.stockReservation.update({
                where: { id: res.id },
                data: {
                  status: 'expired',
                  releasedAt: new Date()
                }
              });

              releasedCount++;
            }

            // E. Transition unpaid order to cancelled
            await tx.order.update({
              where: { id: hold.orderId },
              data: { fulfillmentStatus: 'cancelled' }
            });
          });
        } catch (orderErr) {
          const errMsg = orderErr instanceof Error ? orderErr.message : String(orderErr);
          console.error(`[ReservationCleanup] Failed to release expired hold for order ${hold.orderId}:`, errMsg);
        }
      }

      return releasedCount;
    } finally {
      // 3. Always release PostgreSQL advisory lock
      await prisma.$executeRaw`SELECT pg_advisory_unlock(739281);`;
    }
  },

  /**
   * Fetches the latest order for a given customer phone number.
   */
  async getLatestOrderByCustomerPhone(
    organizationId: string,
    phone: string
  ): Promise<OrderRecord | null> {
    const normalizedPhone = formatPhoneNumber(phone);
    const customer = await prisma.customer.findUnique({
      where: {
        uq_customer_org_phone: {
          organizationId,
          phoneNumber: normalizedPhone
        }
      },
      select: { id: true }
    });

    if (!customer) return null;

    const order = await prisma.order.findFirst({
      where: {
        organizationId,
        customerId: customer.id
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true }
    });

    if (!order) return null;
    return this.getOrderById(organizationId, order.id);
  },

  /**
   * Fetches an order by its human-readable order_number.
   */
  async getOrderByNumber(
    organizationId: string,
    orderNumber: number | string
  ): Promise<OrderRecord | null> {
    const num = Number(orderNumber);
    if (isNaN(num)) return null;

    const row = await prisma.order.findFirst({
      where: {
        organizationId,
        orderNumber: num
      },
      include: {
        customer: {
          select: {
            phoneNumber: true,
            displayName: true
          }
        },
        orderItems: {
          include: {
            jersey: {
              select: {
                title: true,
                imageUrl: true
              }
            }
          }
        }
      }
    });

    if (!row) return null;
    return mapOrderToRecord(row);
  },

  /**
   * Concurrency-safe, transactional update of customer delivery address and notes.
   * Strictly enforces the fulfillment lifecycle state machine at the database level.
   */
  async updateOrderAddressAndNotes(
    input: UpdateOrderAddressInput
  ): Promise<UpdateOrderAddressResult> {
    const {
      organizationId,
      customerId,
      orderIdentifier,
      shippingAddress,
      deliveryNotes,
      conversationId
    } = input;

    // Sanitize and limit delivery address to 500 characters
    const sanitizedAddress = shippingAddress
      .trim()
      .replace(/\r?\n+/g, ', ')
      .replace(/\s+/g, ' ')
      .slice(0, 500);

    if (!sanitizedAddress) {
      return {
        success: false,
        code: 'ORDER_NOT_FOUND',
        message: 'A valid delivery address must be provided.',
        instruction: 'Ask the customer to provide a valid delivery address.'
      };
    }

    return prisma.$transaction(async (tx) => {
      // 1. Locate the target order scoped by organizationId and customerId
      let targetOrder: {
        id: string;
        orderNumber: number;
        fulfillmentStatus: string;
        shippingTrackingNumber: string | null;
        shippingAddress: string | null;
        notes: string | null;
      } | null = null;

      if (orderIdentifier && orderIdentifier.trim()) {
        const cleaned = orderIdentifier.trim().replace(/^#/, '');
        const parsedNum = Number(cleaned);

        if (!isNaN(parsedNum) && parsedNum > 0) {
          targetOrder = await tx.order.findFirst({
            where: {
              organizationId,
              customerId,
              orderNumber: parsedNum
            },
            select: {
              id: true,
              orderNumber: true,
              fulfillmentStatus: true,
              shippingTrackingNumber: true,
              shippingAddress: true,
              notes: true
            }
          });
        }

        // If not found by orderNumber, attempt by UUID if valid format
        if (!targetOrder && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleaned)) {
          targetOrder = await tx.order.findFirst({
            where: {
              id: cleaned,
              organizationId,
              customerId
            },
            select: {
              id: true,
              orderNumber: true,
              fulfillmentStatus: true,
              shippingTrackingNumber: true,
              shippingAddress: true,
              notes: true
            }
          });
        }
      } else {
        // Default to customer's most recent active (non-cancelled) order
        targetOrder = await tx.order.findFirst({
          where: {
            organizationId,
            customerId,
            fulfillmentStatus: { not: 'cancelled' }
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            orderNumber: true,
            fulfillmentStatus: true,
            shippingTrackingNumber: true,
            shippingAddress: true,
            notes: true
          }
        });
      }

      if (!targetOrder) {
        return {
          success: false,
          code: 'ORDER_NOT_FOUND',
          message: 'No active order found for this customer.',
          instruction: 'Inform the customer that we could not find an active order under their account. Ask if they have an order number.'
        };
      }

      // 2. Lock the order row to eliminate concurrent fulfillment races
      const lockedRows = await tx.$queryRaw<Array<{
        id: string;
        fulfillment_status: string;
        shipping_tracking_number: string | null;
        shipping_address: string | null;
        notes: string | null;
      }>>`
        SELECT id, fulfillment_status, shipping_tracking_number, shipping_address, notes
        FROM orders
        WHERE id = ${targetOrder.id}::uuid
          AND organization_id = ${organizationId}
        FOR UPDATE;
      `;

      if (!lockedRows || lockedRows.length === 0) {
        return {
          success: false,
          code: 'ORDER_NOT_FOUND',
          message: 'Order could not be locked for update.',
          instruction: 'Inform the customer that the order could not be updated at this moment.'
        };
      }

      const lockedOrder = lockedRows[0];
      const status = lockedOrder.fulfillment_status as FulfillmentStatus;
      const tracking = lockedOrder.shipping_tracking_number;
      const prevAddress = lockedOrder.shipping_address;
      const prevNotes = lockedOrder.notes;

      // 3. State Machine Guardrails (Physical fulfillment boundary enforcement)
      if (status === 'shipped') {
        return {
          success: false,
          code: 'ORDER_ALREADY_SHIPPED',
          orderId: targetOrder.id,
          orderNumber: targetOrder.orderNumber,
          fulfillmentStatus: status,
          trackingNumber: tracking,
          message: `Order #${targetOrder.orderNumber} has already been shipped with carrier tracking ${tracking || 'assigned'}.`,
          instruction: `Inform the customer that order #${targetOrder.orderNumber} has already been shipped (Tracking: ${tracking || 'in transit'}) and cannot be redirected automatically. Advise them to contact our support team.`
        };
      }

      if (status === 'delivered') {
        return {
          success: false,
          code: 'ORDER_ALREADY_DELIVERED',
          orderId: targetOrder.id,
          orderNumber: targetOrder.orderNumber,
          fulfillmentStatus: status,
          message: `Order #${targetOrder.orderNumber} has already been delivered.`,
          instruction: `Inform the customer that order #${targetOrder.orderNumber} is marked as delivered and its address cannot be modified.`
        };
      }

      if (status === 'cancelled') {
        return {
          success: false,
          code: 'ORDER_CANCELLED',
          orderId: targetOrder.id,
          orderNumber: targetOrder.orderNumber,
          fulfillmentStatus: status,
          message: `Order #${targetOrder.orderNumber} was cancelled.`,
          instruction: `Inform the customer that order #${targetOrder.orderNumber} is cancelled and cannot receive address updates.`
        };
      }

      if (status === 'printing' && tracking) {
        return {
          success: false,
          code: 'ORDER_HANDED_TO_COURIER',
          orderId: targetOrder.id,
          orderNumber: targetOrder.orderNumber,
          fulfillmentStatus: status,
          trackingNumber: tracking,
          message: `Order #${targetOrder.orderNumber} has already been booked with the courier and assigned tracking number ${tracking}.`,
          instruction: `Explain that order #${targetOrder.orderNumber} has already been packaged and booked with the courier (Tracking: ${tracking}). Direct them to support for manual rerouting.`
        };
      }

      // 4. Allowed: 'unfulfilled' or 'printing' without courier tracking assigned
      const updateData: Prisma.OrderUpdateInput = {
        shippingAddress: sanitizedAddress
      };

      const sanitizedNote = deliveryNotes
        ? deliveryNotes.trim().replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').slice(0, 500)
        : undefined;

      let newNotes = prevNotes;
      if (sanitizedNote) {
        const noteEntry = `[Delivery Note]: ${sanitizedNote}`;
        if (prevNotes) {
          const combined = `${prevNotes}\n${noteEntry}`;
          // Cap total notes length to 4,000 characters to prevent database bloat
          newNotes = combined.length > 4000 ? combined.slice(combined.length - 4000) : combined;
        } else {
          newNotes = noteEntry;
        }
        updateData.notes = newNotes;
      }

      // Update Order
      await tx.order.update({
        where: { id: targetOrder.id },
        data: updateData
      });

      // Sync customer profile's default shipping address
      await tx.customer.update({
        where: { id: customerId },
        data: { shippingAddress: sanitizedAddress }
      });

      // 5. Append immutable audit trail log
      await tx.auditLog.create({
        data: {
          organizationId,
          actor: 'ai_sales_agent',
          action: 'ORDER_ADDRESS_UPDATED',
          targetEntity: 'order',
          targetId: targetOrder.id,
          details: {
            orderNumber: targetOrder.orderNumber,
            fulfillmentStatus: status,
            previousAddress: prevAddress,
            newAddress: sanitizedAddress,
            previousDeliveryNotes: prevNotes,
            newDeliveryNotes: sanitizedNote || null,
            conversationId,
            timestamp: new Date().toISOString()
          }
        }
      });

      // Sanitize address preview to eliminate prompt injection brackets or control chars
      const safeAddressPreview = sanitizedAddress.replace(/[[\]{}<>`"'\\]/g, ' ').replace(/\s+/g, ' ').trim();

      return {
        success: true,
        code: 'ADDRESS_UPDATED',
        orderId: targetOrder.id,
        orderNumber: targetOrder.orderNumber,
        fulfillmentStatus: status,
        previousAddress: prevAddress,
        updatedAddress: sanitizedAddress,
        previousDeliveryNotes: prevNotes,
        updatedDeliveryNotes: sanitizedNote,
        message: `Delivery address successfully updated for order #${targetOrder.orderNumber}.`,
        instruction: `Confirm to the customer that their delivery address for order #${targetOrder.orderNumber} has been updated to "${safeAddressPreview}".`
      };
    });
  }
};
