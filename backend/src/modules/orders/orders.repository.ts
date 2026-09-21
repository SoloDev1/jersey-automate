import { supabase } from '../../core/database/supabase.js';
import { formatPhoneNumber } from '../../core/utils/phoneFormatter.js';
import {
  OrderRecord,
  OrderItemRecord,
  CreateOrderDTO,
  UpdateOrderStatusDTO,
  OrderFilterDTO,
  PaymentStatus,
  FulfillmentStatus
} from './orders.types.js';
import { PaginatedResult } from '../catalog/catalog.types.js';

export const ordersRepository = {
  /**
   * Finds an existing customer by phone number or creates a new record.
   */
  async findOrCreateCustomer(
    organizationId: string,
    phoneNumber: string,
    displayName?: string
  ): Promise<{ id: string; phoneNumber: string; displayName: string | null }> {
    const normalizedPhone = formatPhoneNumber(phoneNumber);
    const { data: existing } = await supabase
      .from('customers')
      .select('id, phone_number, display_name')
      .eq('organization_id', organizationId)
      .eq('phone_number', normalizedPhone)
      .maybeSingle();

    if (existing) {
      if (displayName && displayName !== existing.display_name) {
        await supabase
          .from('customers')
          .update({ display_name: displayName, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      }
      return {
        id: existing.id,
        phoneNumber: existing.phone_number,
        displayName: displayName || existing.display_name
      };
    }

    const { data: created, error } = await supabase
      .from('customers')
      .insert({
        organization_id: organizationId,
        phone_number: normalizedPhone,
        display_name: displayName || null
      })
      .select('id, phone_number, display_name')
      .single();

    if (error || !created) throw error;
    return {
      id: created.id,
      phoneNumber: created.phone_number,
      displayName: created.display_name
    };
  },

  /**
   * Retrieves organization store settings (fees, currency).
   */
  async getStoreSettings(organizationId: string) {
    const { data } = await supabase
      .from('settings')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle();

    return {
      currency: data?.currency || 'NGN',
      shippingFee: Number(data?.default_shipping_fee ?? 2000),
      printingFee: Number(data?.custom_printing_fee ?? 3000)
    };
  },

  /**
   * Creates an order, order items, and executes atomic stock reservation.
   * Total price is calculated strictly on the server from jerseys and settings.
   */
  async createOrderWithReservation(
    organizationId: string,
    dto: CreateOrderDTO,
    ttlMinutes = 15
  ): Promise<OrderRecord> {
    // 1. Resolve or create customer
    const customer = await this.findOrCreateCustomer(
      organizationId,
      dto.customerPhone,
      dto.customerName
    );

    // 2. Fetch settings
    const settings = await this.getStoreSettings(organizationId);

    // 3. Fetch kit details to calculate prices strictly on server
    const jerseyIds = dto.items.map((i) => i.jerseyId);
    const { data: jerseysData, error: jerseyErr } = await supabase
      .from('jerseys')
      .select('id, title, base_price, is_active')
      .eq('organization_id', organizationId)
      .in('id', jerseyIds);

    if (jerseyErr || !jerseysData) throw jerseyErr;

    const jerseyMap = new Map(jerseysData.map((j) => [j.id, j]));

    let subtotal = 0;
    const orderItemsToInsert = dto.items.map((item) => {
      const jersey = jerseyMap.get(item.jerseyId);
      if (!jersey || !jersey.is_active) {
        throw new Error(`Jersey ${item.jerseyId} is not available for purchase`);
      }

      const unitPrice = Number(jersey.base_price);
      const hasCustomization = Boolean(item.customName || item.customNumber);
      const printingFee = hasCustomization ? settings.printingFee : 0;
      const itemTotal = (unitPrice + printingFee) * item.quantity;
      subtotal += itemTotal;

      return {
        jersey_id: item.jerseyId,
        size: item.size,
        quantity: item.quantity,
        unit_price: unitPrice,
        custom_name: item.customName || null,
        custom_number: item.customNumber || null,
        printing_fee: printingFee
      };
    });

    const totalAmount = subtotal + settings.shippingFee;

    // 4. Create pending order row
    const { data: orderData, error: orderErr } = await supabase
      .from('orders')
      .insert({
        organization_id: organizationId,
        customer_id: customer.id,
        subtotal,
        shipping_fee: settings.shippingFee,
        total_amount: totalAmount,
        currency: settings.currency,
        payment_status: 'pending',
        fulfillment_status: 'unfulfilled',
        shipping_address: dto.shippingAddress || null,
        notes: dto.notes || null
      })
      .select()
      .single();

    if (orderErr || !orderData) throw orderErr;

    // 5. Insert order items
    const itemsPayload = orderItemsToInsert.map((item) => ({
      ...item,
      order_id: orderData.id
    }));

    const { data: itemsData, error: itemsErr } = await supabase
      .from('order_items')
      .insert(itemsPayload)
      .select();

    if (itemsErr) throw itemsErr;

    // 6. Execute atomic stock reservation procedure in PostgreSQL
    const { error: rpcErr } = await supabase.rpc('reserve_order_stock', {
      p_order_id: orderData.id,
      p_ttl_minutes: ttlMinutes
    });

    if (rpcErr) {
      // Roll back created order if stock reservation fails
      await supabase.from('orders').delete().eq('id', orderData.id);
      throw new Error(`Stock reservation failed: ${rpcErr.message}`);
    }

    const fullOrder = await this.getOrderById(organizationId, orderData.id);
    if (!fullOrder) {
      throw new Error(`Order ${orderData.id} was created but could not be reloaded`);
    }
    return fullOrder;
  },

  /**
   * Fetches an order with all items and customer details.
   */
  async getOrderById(organizationId: string, id: string): Promise<OrderRecord | null> {
    const { data, error } = await supabase
      .from('orders')
      .select('*, customers(phone_number, display_name), order_items(*, jerseys(title, image_url))')
      .eq('organization_id', organizationId)
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.id,
      organizationId: data.organization_id,
      orderNumber: data.order_number,
      customerId: data.customer_id,
      subtotal: Number(data.subtotal),
      shippingFee: Number(data.shipping_fee),
      totalAmount: Number(data.total_amount),
      currency: data.currency,
      paymentStatus: data.payment_status as PaymentStatus,
      fulfillmentStatus: data.fulfillment_status as FulfillmentStatus,
      paystackReference: data.paystack_reference,
      paystackAccessCode: data.paystack_access_code,
      paymentUrl: data.payment_url,
      reservationExpiresAt: data.reservation_expires_at,
      shippingAddress: data.shipping_address,
      shippingTrackingNumber: data.shipping_tracking_number,
      notes: data.notes,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      customerPhone: data.customers?.phone_number,
      customerName: data.customers?.display_name,
      items: (data.order_items || []).map((item: any) => ({
        id: item.id,
        orderId: item.order_id,
        jerseyId: item.jersey_id,
        size: item.size,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        customName: item.custom_name,
        customNumber: item.custom_number,
        printingFee: Number(item.printing_fee),
        createdAt: item.created_at,
        jerseyTitle: item.jerseys?.title,
        jerseyImage: item.jerseys?.image_url
      }))
    };
  },

  /**
   * Fetches an order by its Paystack reference.
   */
  async getOrderByPaystackRef(paystackReference: string): Promise<OrderRecord | null> {
    const { data, error } = await supabase
      .from('orders')
      .select('*, customers(phone_number, display_name), order_items(*, jerseys(title, image_url))')
      .eq('paystack_reference', paystackReference)
      .maybeSingle();

    if (error || !data) return null;
    return this.getOrderById(data.organization_id, data.id);
  },

  /**
   * Updates an order's Paystack payment initiation details.
   */
  async attachPaystackDetails(
    orderId: string,
    paystackReference: string,
    accessCode: string,
    paymentUrl: string
  ): Promise<void> {
    const { error } = await supabase
      .from('orders')
      .update({
        paystack_reference: paystackReference,
        paystack_access_code: accessCode,
        payment_url: paymentUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) throw error;
  },

  /**
   * Marks an order as paid upon verified transaction confirmation.
   */
  async markOrderPaid(orderId: string): Promise<void> {
    const { error } = await supabase
      .from('orders')
      .update({
        payment_status: 'paid',
        fulfillment_status: 'printing',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) throw error;
  },

  /**
   * Updates fulfillment status or tracking number.
   */
  async updateStatus(
    organizationId: string,
    orderId: string,
    dto: UpdateOrderStatusDTO
  ): Promise<OrderRecord | null> {
    const updates: any = { updated_at: new Date().toISOString() };
    if (dto.fulfillmentStatus) updates.fulfillment_status = dto.fulfillmentStatus;
    if (dto.shippingTrackingNumber) updates.shipping_tracking_number = dto.shippingTrackingNumber;
    if (dto.notes) updates.notes = dto.notes;

    const { error } = await supabase
      .from('orders')
      .update(updates)
      .eq('organization_id', organizationId)
      .eq('id', orderId);

    if (error) throw error;
    return this.getOrderById(organizationId, orderId);
  },

  /**
   * Lists orders with filters and pagination.
   */
  async listOrders(
    organizationId: string,
    filter: OrderFilterDTO
  ): Promise<PaginatedResult<OrderRecord>> {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('orders')
      .select('*, customers(phone_number, display_name), order_items(*, jerseys(title, image_url))', {
        count: 'exact'
      })
      .eq('organization_id', organizationId);

    if (filter.paymentStatus) {
      query = query.eq('payment_status', filter.paymentStatus);
    }
    if (filter.fulfillmentStatus) {
      query = query.eq('fulfillment_status', filter.fulfillmentStatus);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    const total = count || 0;
    const formatted: OrderRecord[] = (data || []).map((row: any) => ({
      id: row.id,
      organizationId: row.organization_id,
      orderNumber: row.order_number,
      customerId: row.customer_id,
      subtotal: Number(row.subtotal),
      shippingFee: Number(row.shipping_fee),
      totalAmount: Number(row.total_amount),
      currency: row.currency,
      paymentStatus: row.payment_status as PaymentStatus,
      fulfillmentStatus: row.fulfillment_status as FulfillmentStatus,
      paystackReference: row.paystack_reference,
      paystackAccessCode: row.paystack_access_code,
      paymentUrl: row.payment_url,
      reservationExpiresAt: row.reservation_expires_at,
      shippingAddress: row.shipping_address,
      shippingTrackingNumber: row.shipping_tracking_number,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      customerPhone: row.customers?.phone_number,
      customerName: row.customers?.display_name,
      items: (row.order_items || []).map((item: any) => ({
        id: item.id,
        orderId: item.order_id,
        jerseyId: item.jersey_id,
        size: item.size,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        customName: item.custom_name,
        customNumber: item.custom_number,
        printingFee: Number(item.printing_fee),
        createdAt: item.created_at,
        jerseyTitle: item.jerseys?.title,
        jerseyImage: item.jerseys?.image_url
      }))
    }));

    return {
      data: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }
};
