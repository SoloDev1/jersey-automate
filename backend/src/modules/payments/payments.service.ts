import crypto from 'node:crypto';
import axios from 'axios';
import { env } from '../../core/config/env.js';
import { supabase } from '../../core/database/supabase.js';
import { ordersRepository } from '../orders/orders.repository.js';
import {
  PaystackInitResponse,
  PaystackVerifyResponse,
  PaymentRecord
} from './payments.types.js';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

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
      throw new Error(`Order reservation has expired. Please create a new order.`);
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
   * Processes a verified payment transaction:
   * 1. Checks idempotency (prevents double-crediting if duplicate webhooks fire).
   * 2. Confirms verified amount strictly equals order total in kobo.
   * 3. Inserts payment audit row.
   * 4. Marks order status 'paid'.
   * 5. Atomically finalizes stock hold in PostgreSQL via `finalize_order_stock`.
   */
  async processVerifiedPayment(
    reference: string,
    verifiedData?: PaystackVerifyResponse['data']
  ): Promise<PaymentRecord> {
    // 1. If verifiedData wasn't pre-fetched, verify directly with Paystack
    const data = verifiedData || (await this.verifyTransaction(reference));

    if (data.status !== 'success') {
      throw new Error(`Transaction ${reference} is not successful (status: ${data.status})`);
    }

    // 2. Locate order by Paystack reference
    const order = await ordersRepository.getOrderByPaystackRef(reference);
    if (!order) {
      throw new Error(`No order associated with Paystack reference ${reference}`);
    }

    // Check if payment already exists (Idempotency)
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('*')
      .eq('paystack_reference', reference)
      .maybeSingle();

    if (existingPayment) {
      return {
        id: existingPayment.id,
        organizationId: existingPayment.organization_id,
        orderId: existingPayment.order_id,
        paystackReference: existingPayment.paystack_reference,
        amountPaid: Number(existingPayment.amount_paid),
        currency: existingPayment.currency,
        channel: existingPayment.channel,
        status: existingPayment.status,
        verifiedAt: existingPayment.verified_at,
        createdAt: existingPayment.created_at
      };
    }

    // 3. Ensure verified amount matches order total down to the exact cent
    const expectedAmountKobo = Math.round(order.totalAmount * 100);
    if (data.amount !== expectedAmountKobo) {
      throw new Error(
        `Financial mismatch! Paid: ${data.amount} Kobo, Expected: ${expectedAmountKobo} Kobo`
      );
    }

    // 4. Insert verified payment record (Protected by UNIQUE (order_id) WHERE status = 'success')
    const { data: paymentRecord, error: payErr } = await supabase
      .from('payments')
      .insert({
        organization_id: order.organizationId,
        order_id: order.id,
        paystack_reference: reference,
        amount_paid: Number((data.amount / 100).toFixed(2)),
        currency: data.currency,
        channel: data.channel || 'unknown',
        status: 'success',
        paystack_response: data,
        verified_at: data.paid_at || new Date().toISOString()
      })
      .select()
      .single();

    if (payErr || !paymentRecord) throw payErr;

    // 5. Mark order as paid
    await ordersRepository.markOrderPaid(order.id);

    // 6. Atomically finalize stock deduction in PostgreSQL
    const { error: stockErr } = await supabase.rpc('finalize_order_stock', {
      p_order_id: order.id
    });

    if (stockErr) {
      console.error(
        `[CRITICAL] Stock finalization failed for paid order ${order.id}:`,
        stockErr.message
      );
    }

    // 7. Update customer total spend and orders metrics
    try {
      await supabase.rpc('increment_customer_orders', {
        p_customer_id: order.customerId,
        p_spend: order.totalAmount
      });
    } catch {
      // Non-blocking metric increment
    }

    // 8. Dispatch automated WhatsApp receipt & update CRM chat
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
          `Your kit is now being packaged and prepared for shipping. We will notify you once your package is on its way! 🚚`
        ]
          .filter(Boolean)
          .join('\n');

        // Dispatch receipt via WhatsApp
        const metaMessageId = await whatsappService.sendTextMessage(order.organizationId, {
          toPhone: order.customerPhone,
          body: receiptMessage
        });

        // Link to customer conversation in CRM
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
      } catch (notifyErr: any) {
        console.warn(
          `[Payment Notification] Failed to dispatch WhatsApp receipt for order ${order.id}:`,
          notifyErr?.message
        );
      }
    }

    return {
      id: paymentRecord.id,
      organizationId: paymentRecord.organization_id,
      orderId: paymentRecord.order_id,
      paystackReference: paymentRecord.paystack_reference,
      amountPaid: Number(paymentRecord.amount_paid),
      currency: paymentRecord.currency,
      channel: paymentRecord.channel,
      status: paymentRecord.status,
      verifiedAt: paymentRecord.verified_at,
      createdAt: paymentRecord.created_at
    };
  }
};
