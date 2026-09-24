import crypto from 'node:crypto';
import axios from 'axios';
import { env } from '../../core/config/env.js';
import { prisma } from '../../core/database/prisma.js';
import { Prisma } from '@prisma/client';
import { ordersRepository } from '../orders/orders.repository.js';
import {
  PaystackInitResponse,
  PaystackVerifyResponse,
  PaymentRecord
} from './payments.types.js';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

interface LockedInventoryRow {
  id: string;
  quantity_on_hand: number;
  quantity_reserved: number;
}

export const paymentsService = {
  /**
   * Initializes a Paystack transaction for an existing pending order.
   * Total price is strictly retrieved from the database (never from user input).
   */
  async initializePayment(
    organizationId: string,
    orderId: string,
    email: string
  ): Promise<{ authorizationUrl: string; reference: string; accessCode: string }> {
    const order = await ordersRepository.getOrderById(organizationId, orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.paymentStatus === 'paid') {
      throw new Error(`Order ${orderId} is already paid`);
    }

    if (order.reservationExpiresAt && new Date(order.reservationExpiresAt) < new Date()) {
      throw new Error('Order reservation has expired. Please create a new order.');
    }

    // Paystack takes amount in lowest currency unit (Kobo for NGN, Cents for USD)
    const amountInKobo = Math.round(order.totalAmount * 100);
    const randomSuffix = crypto.randomBytes(3).toString('hex');
    const reference = `ORDER_${order.orderNumber}_${Date.now()}_${randomSuffix}`;

    const response = await axios.post<PaystackInitResponse>(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        email,
        amount: amountInKobo,
        currency: order.currency,
        reference,
        metadata: {
          organization_id: organizationId,
          order_id: order.id,
          order_number: order.orderNumber,
          customer_phone: order.customerPhone
        }
      },
      {
        headers: {
          Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    if (!response.data.status) {
      throw new Error(`Paystack initialization failed: ${response.data.message}`);
    }

    const { authorization_url, access_code } = response.data.data;

    // Attach Paystack reference to order
    await ordersRepository.attachPaystackDetails(
      organizationId,
      order.id,
      reference,
      access_code,
      authorization_url
    );

    return {
      authorizationUrl: authorization_url,
      reference,
      accessCode: access_code
    };
  },

  /**
   * Verifies the HMAC-SHA512 signature on incoming Paystack webhooks.
   */
  verifyWebhookSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    if (!rawBody || !signature) return false;

    const hash = crypto
      .createHmac('sha512', env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest('hex');

    const hashBuf = Buffer.from(hash, 'utf8');
    const sigBuf = Buffer.from(signature, 'utf8');

    if (hashBuf.length !== sigBuf.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(hashBuf, sigBuf);
    } catch {
      return false;
    }
  },

  /**
   * Directly queries Paystack's verification API.
   * Mandatory safeguard before marking an order as paid.
   */
  async verifyTransaction(reference: string): Promise<PaystackVerifyResponse['data']> {
    const response = await axios.get<PaystackVerifyResponse>(
      `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`
        },
        timeout: 10000
      }
    );

    if (!response.data.status) {
      throw new Error(`Paystack verification failed: ${response.data.message}`);
    }

    return response.data.data;
  },

  /**
   * Processes a verified payment transaction with complete idempotency and concurrency protection:
   * 1. Direct Paystack status verification (rejects non-successful payments).
   * 2. Multilevel idempotency check: prevents duplicate processing of duplicate webhooks.
   * 3. Strict financial amount and currency verification against database order total.
   * 4. Atomic PostgreSQL transaction:
   *    - Row-level pessimistic locking (FOR UPDATE) on inventory rows.
   *    - Finalizes stock hold: decrements quantity_on_hand and quantity_reserved (reserved -> sold).
   *    - Logs immutable movement in inventory_movements ledger.
   *    - Marks stock reservation as finalized.
   *    - Marks order as paid with fulfillment status printing.
   *    - Atomically increments customer lifetime spend and order count.
   *    - Inserts payment record.
   * 5. Dispatches WhatsApp receipt message asynchronously outside transaction boundaries.
   */
  async processVerifiedPayment(
    reference: string,
    verifiedData?: PaystackVerifyResponse['data']
  ): Promise<PaymentRecord> {
    // 1. If verifiedData wasn't pre-fetched, verify directly with Paystack API
    const data = verifiedData || (await this.verifyTransaction(reference));

    if (data.status !== 'success') {
      throw new Error(`Transaction ${reference} is not successful (status: ${data.status})`);
    }

    // 2. Fast-Path Idempotency Check: if payment is already recorded, return it immediately
    const existingPayment = await prisma.payment.findUnique({
      where: { paystackReference: reference }
    });

    if (existingPayment) {
      return {
        id: existingPayment.id,
        organizationId: existingPayment.organizationId,
        orderId: existingPayment.orderId,
        paystackReference: existingPayment.paystackReference,
        amountPaid: Number(existingPayment.amountPaid),
        currency: existingPayment.currency,
        channel: existingPayment.channel,
        status: existingPayment.status,
        verifiedAt: existingPayment.verifiedAt.toISOString(),
        createdAt: existingPayment.createdAt.toISOString()
      };
    }

    // 3. Locate order by Paystack reference (scoped by organization_id metadata when present)
    const orgId = typeof (data.metadata as Record<string, unknown> | undefined)?.organization_id === 'string'
      ? ((data.metadata as Record<string, unknown>).organization_id as string)
      : undefined;
    const order = await ordersRepository.getOrderByPaystackRef(reference, orgId);
    if (!order) {
      throw new Error(`No order associated with Paystack reference ${reference}`);
    }

    // Order state idempotency check: if already paid, locate existing payment
    if (order.paymentStatus === 'paid') {
      const recordedPayment = await prisma.payment.findFirst({
        where: { orderId: order.id }
      });
      if (recordedPayment) {
        return {
          id: recordedPayment.id,
          organizationId: recordedPayment.organizationId,
          orderId: recordedPayment.orderId,
          paystackReference: recordedPayment.paystackReference,
          amountPaid: Number(recordedPayment.amountPaid),
          currency: recordedPayment.currency,
          channel: recordedPayment.channel,
          status: recordedPayment.status,
          verifiedAt: recordedPayment.verifiedAt.toISOString(),
          createdAt: recordedPayment.createdAt.toISOString()
        };
      }
    }

    // 4. Strict Currency and Financial Amount Integrity Checks
    if (data.currency.toUpperCase() !== order.currency.toUpperCase()) {
      throw new Error(
        `Currency mismatch! Paid: ${data.currency}, Expected: ${order.currency}`
      );
    }

    const expectedAmountKobo = Math.round(order.totalAmount * 100);
    if (data.amount !== expectedAmountKobo) {
      throw new Error(
        `Financial mismatch! Paid: ${data.amount} Kobo, Expected: ${expectedAmountKobo} Kobo`
      );
    }

    // 5. Atomic PostgreSQL Interactive Transaction: Stock Finalization + Order Update + Payment Creation
    const paymentRecord = await prisma.$transaction(async (tx) => {
      // Internal idempotency check inside transaction
      const duplicateCheck = await tx.payment.findUnique({
        where: { paystackReference: reference }
      });
      if (duplicateCheck) {
        return duplicateCheck;
      }

      // Fetch active stock reservations for this order
      const activeReservations = await tx.stockReservation.findMany({
        where: {
          organizationId: order.organizationId,
          orderId: order.id,
          status: 'active'
        }
      });

      // Finalize stock for each active reservation: transition from reserved -> sold
      for (const res of activeReservations) {
        const lockedRows = await tx.$queryRaw<LockedInventoryRow[]>`
          SELECT id, quantity_on_hand, quantity_reserved
          FROM jersey_inventory
          WHERE organization_id = ${order.organizationId}
            AND jersey_id = ${res.jerseyId}::uuid
            AND size = ${res.size}
          FOR UPDATE;
        `;

        if (lockedRows && lockedRows.length > 0) {
          const inv = lockedRows[0];
          const newOnHand = Math.max(0, inv.quantity_on_hand - res.quantity);
          const newReserved = Math.max(0, inv.quantity_reserved - res.quantity);

          await tx.jerseyInventory.update({
            where: { id: inv.id },
            data: {
              quantityOnHand: newOnHand,
              quantityReserved: newReserved
            }
          });

          // Immutable audit record of sold inventory
          await tx.inventoryMovement.create({
            data: {
              organizationId: order.organizationId,
              jerseyId: res.jerseyId,
              size: res.size,
              movementType: 'sold',
              quantityDelta: -res.quantity,
              quantityOnHandBefore: inv.quantity_on_hand,
              quantityOnHandAfter: newOnHand,
              quantityReservedBefore: inv.quantity_reserved,
              quantityReservedAfter: newReserved,
              orderId: order.id,
              reservationId: res.id,
              actor: 'paystack_webhook',
              reason: `Order #${order.orderNumber} payment confirmed`
            }
          });
        }

        // Mark reservation finalized
        await tx.stockReservation.update({
          where: { id: res.id },
          data: {
            status: 'finalized',
            finalizedAt: new Date()
          }
        });
      }

      // Update order to paid & printing
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'paid',
          fulfillmentStatus: 'printing'
        }
      });

      // Increment customer lifetime metrics atomically
      await tx.customer.update({
        where: { id: order.customerId },
        data: {
          totalOrders: { increment: 1 },
          totalSpend: { increment: order.totalAmount },
          lastContactAt: new Date()
        }
      });

      // Insert payment record
      const createdPayment = await tx.payment.create({
        data: {
          organizationId: order.organizationId,
          orderId: order.id,
          paystackReference: reference,
          amountPaid: Number((data.amount / 100).toFixed(2)),
          currency: data.currency,
          channel: data.channel || 'unknown',
          status: 'success',
          paystackResponse: data as unknown as Prisma.InputJsonValue,
          verifiedAt: data.paid_at ? new Date(data.paid_at) : new Date()
        }
      });

      return createdPayment;
    });

    // 6. Asynchronous WhatsApp Receipt Dispatch (Safely Outside DB Transaction)
    if (order.customerPhone) {
      try {
        const { whatsappService } = await import('../whatsapp/whatsapp.service.js');
        const { chatRepository } = await import('../chat/chat.repository.js');

        const itemsSummary = (order.items || [])
          .map((i) => `• *${i.jerseyTitle || 'Jersey'}* (Size: *${i.size}*, Qty: ${i.quantity})`)
          .join('\n');

        const formattedAmount = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: order.currency
        }).format(order.totalAmount);

        const customerGreeting = order.customerName ? ` ${order.customerName}` : '';
        const receiptMessage = [
          `🎉 *PAYMENT RECEIVED & CONFIRMED!*`,
          ``,
          `Thank you${customerGreeting}! We have successfully received your payment of *${formattedAmount}*.`,
          ``,
          `📋 *Receipt & Order Details:*`,
          `• *Order Number:* #${order.orderNumber}`,
          `• *Payment Status:* Paid via ${data.channel || 'Paystack'} ✅`,
          itemsSummary ? `\n*Items Ordered:*\n${itemsSummary}` : '',
          order.shippingAddress ? `• *Delivery Address:* ${order.shippingAddress}` : '',
          ``,
          `📦 *What happens next?*`,
          `Your payment has been confirmed! We will notify you here once your order is prepared and dispatched 🚚`
        ]
          .filter(Boolean)
          .join('\n');

        const metaMessageId = await whatsappService.sendTextMessage(order.organizationId, {
          toPhone: order.customerPhone,
          body: receiptMessage
        });

        const conversation = await chatRepository.findOrCreateConversation(
          order.organizationId,
          order.customerId
        );

        await chatRepository.insertMessage(order.organizationId, {
          conversationId: conversation.id,
          metaMessageId,
          direction: 'outbound',
          type: 'text',
          body: receiptMessage,
          deliveryStatus: 'sent'
        });
      } catch (notifyErr: unknown) {
        const msg = notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
        console.warn(
          `[Payment Notification] Failed to dispatch WhatsApp receipt for order ${order.id}:`,
          msg
        );
      }
    }

    return {
      id: paymentRecord.id,
      organizationId: paymentRecord.organizationId,
      orderId: paymentRecord.orderId,
      paystackReference: paymentRecord.paystackReference,
      amountPaid: Number(paymentRecord.amountPaid),
      currency: paymentRecord.currency,
      channel: paymentRecord.channel,
      status: paymentRecord.status,
      verifiedAt: paymentRecord.verifiedAt.toISOString(),
      createdAt: paymentRecord.createdAt.toISOString()
    };
  }
};
