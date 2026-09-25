import { whatsappService } from './whatsapp.service.js';
import { whatsappActions } from './whatsapp-actions.js';
import { JerseyRecord, JerseySize } from '../catalog/catalog.types.js';
import { chatRepository } from '../chat/chat.repository.js';
import { socketService } from '../../core/socket/socket.service.js';
import { prisma } from '../../core/database/prisma.js';
import { formatPhoneNumber } from '../../core/utils/phoneFormatter.js';
import { ordersService } from '../orders/orders.service.js';
import { paymentsService } from '../payments/payments.service.js';
import { catalogService } from '../catalog/catalog.service.js';
import { conversationStateService } from '../chat/conversation-state.service.js';
import { OrderRecord, PaymentStatus, FulfillmentStatus } from '../orders/orders.types.js';

export const whatsappCommerceService = {
  /**
   * Sends an interactive jersey showcase card with image header, details, and action buttons.
   */
  async sendJerseyCard(
    organizationId: string,
    conversationId: string,
    options: {
      toPhone: string;
      jersey: JerseyRecord;
      currency?: string;
    }
  ): Promise<string> {
    const { jersey, toPhone } = options;
    const currency = options.currency || 'NGN';
    const formattedPrice = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(jersey.basePrice);

    const inStockSizes = (jersey.inventory || [])
      .filter((inv) => inv.quantityAvailable > 0)
      .map((inv) => inv.size);

    const sizesText = inStockSizes.length > 0 ? inStockSizes.join(', ') : 'Sold out';

    const bodyText = [
      `⚽ *${jersey.title}*`,
      `💰 Price: *${formattedPrice}*`,
      `📏 In-Stock Sizes: *${sizesText}*`,
      jersey.description ? `\n📝 ${jersey.description}` : ''
    ]
      .filter(Boolean)
      .join('\n');

    const messageId = await whatsappService.sendInteractiveMessage(organizationId, {
      toPhone,
      header: jersey.imageUrl
        ? {
            type: 'image',
            image: { link: jersey.imageUrl }
          }
        : undefined,
      body: bodyText,
      footer: 'Jersey Hub Official Store',
      action: {
        type: 'button',
        buttons: [
          {
            id: whatsappActions.buildSizes(jersey.id),
            title: '🛒 Buy / Pick Size'
          },
          {
            id: whatsappActions.buildTeam(jersey.team),
            title: '👕 Other Kits'
          },
          {
            id: whatsappActions.buildSupportHuman(),
            title: '💬 Human Agent'
          }
        ]
      }
    });

    const savedMessage = await chatRepository.insertMessage(organizationId, {
      conversationId,
      metaMessageId: messageId,
      direction: 'outbound',
      type: 'interactive_kit',
      body: `⚽ ${jersey.title} - ${currency} ${jersey.basePrice}`,
      mediaUrl: jersey.imageUrl,
      jerseyId: jersey.id,
      deliveryStatus: 'sent'
    });

    if (savedMessage) {
      socketService.emitNewMessage(organizationId, savedMessage);
      const updatedConv = await chatRepository.getConversationById(organizationId, conversationId);
      if (updatedConv) {
        socketService.emitConversationUpdated(organizationId, updatedConv);
      }
    }

    // Persist active product context to conversation state
    await conversationStateService.updateState(organizationId, conversationId, {
      stage: 'viewing_product',
      jerseyId: jersey.id,
      team: jersey.team,
      kitType: jersey.kitType
    });

    return messageId;
  },

  /**
   * Sends an interactive WhatsApp list of available kits for a team.
   */
  async sendKitList(
    organizationId: string,
    conversationId: string,
    options: {
      toPhone: string;
      team: string;
      jerseys: JerseyRecord[];
      currency?: string;
    }
  ): Promise<string> {
    const { team, jerseys, toPhone } = options;
    const currency = options.currency || 'NGN';

    const rows = jerseys.slice(0, 10).map((j) => {
      const inStock = (j.inventory || []).some((inv) => inv.quantityAvailable > 0);
      const priceStr = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency
      }).format(j.basePrice);

      return {
        id: whatsappActions.buildView(j.id),
        title: `${j.kitType} Kit`.slice(0, 24),
        description: `${priceStr} | ${inStock ? 'In Stock' : 'Out of Stock'}`.slice(0, 72)
      };
    });

    const messageId = await whatsappService.sendInteractiveMessage(organizationId, {
      toPhone,
      header: {
        type: 'text',
        text: `⚽ ${team} Kits`
      },
      body: `Here are the available 2026/27 kits for *${team}*. Tap "Select Kit" below to see full details and photos:`,
      footer: 'Tap any kit to view photo & order',
      action: {
        type: 'list',
        buttonText: 'Select Kit',
        sections: [
          {
            title: `${team} 2026/27 Collection`,
            rows
          }
        ]
      }
    });

    const savedMessage = await chatRepository.insertMessage(organizationId, {
      conversationId,
      metaMessageId: messageId,
      direction: 'outbound',
      type: 'text',
      body: `[List Sent: ${team} Kits]`,
      deliveryStatus: 'sent'
    });

    if (savedMessage) {
      socketService.emitNewMessage(organizationId, savedMessage);
      const updatedConv = await chatRepository.getConversationById(organizationId, conversationId);
      if (updatedConv) {
        socketService.emitConversationUpdated(organizationId, updatedConv);
      }
    }

    return messageId;
  },

  /**
   * Sends an interactive size selector for a specific jersey.
   */
  async sendSizePicker(
    organizationId: string,
    conversationId: string,
    options: {
      toPhone: string;
      jersey: JerseyRecord;
      currency?: string;
    }
  ): Promise<string> {
    const { jersey, toPhone } = options;
    const currency = options.currency || 'NGN';
    const formattedPrice = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(jersey.basePrice);

    const availableInventory = (jersey.inventory || []).filter(
      (inv) => inv.quantityAvailable > 0
    );

    if (availableInventory.length === 0) {
      return whatsappService.sendTextMessage(organizationId, {
        toPhone,
        body: `😔 Sorry, *${jersey.title}* is currently sold out in all sizes! Would you like to check another kit?`
      });
    }

    // Up to 3 sizes -> use quick-reply buttons; more than 3 sizes -> use neat list
    let messageId: string;
    if (availableInventory.length <= 3) {
      messageId = await whatsappService.sendInteractiveMessage(organizationId, {
        toPhone,
        body: `Select your size for *${jersey.title}* (${formattedPrice}):`,
        footer: '15-minute stock reservation upon selection',
        action: {
          type: 'button',
          buttons: availableInventory.map((inv) => ({
            id: whatsappActions.buildBuy(jersey.id, inv.size),
            title: `Size ${inv.size}`
          }))
        }
      });
    } else {
      messageId = await whatsappService.sendInteractiveMessage(organizationId, {
        toPhone,
        header: {
          type: 'text',
          text: 'Select Jersey Size'
        },
        body: `Choose your size for *${jersey.title}* (${formattedPrice}) to proceed to checkout:`,
        footer: 'Inventory reserved for 15 minutes',
        action: {
          type: 'list',
          buttonText: 'Choose Size',
          sections: [
            {
              title: 'Available Sizes',
              rows: availableInventory.map((inv) => ({
                id: whatsappActions.buildBuy(jersey.id, inv.size),
                title: `Size ${inv.size}`,
                description: `${inv.quantityAvailable} in stock - ${formattedPrice}`
              }))
            }
          ]
        }
      });
    }

    const savedMessage = await chatRepository.insertMessage(organizationId, {
      conversationId,
      metaMessageId: messageId,
      direction: 'outbound',
      type: 'text',
      body: `[Size Selector sent for ${jersey.title}]`,
      deliveryStatus: 'sent'
    });

    if (savedMessage) {
      socketService.emitNewMessage(organizationId, savedMessage);
      const updatedConv = await chatRepository.getConversationById(organizationId, conversationId);
      if (updatedConv) {
        socketService.emitConversationUpdated(organizationId, updatedConv);
      }
    }

    // Persist selecting_size stage to conversation state
    await conversationStateService.updateState(organizationId, conversationId, {
      stage: 'selecting_size',
      jerseyId: jersey.id,
      team: jersey.team,
      kitType: jersey.kitType
    });

    return messageId;
  },

  /**
   * Sends an official order reservation card with Paystack checkout link.
   */
  async sendCheckoutCard(
    organizationId: string,
    conversationId: string,
    options: {
      toPhone: string;
      orderNumber: number;
      jerseyTitle: string;
      size: JerseySize;
      totalAmount: number;
      currency: string;
      paymentUrl: string;
    }
  ): Promise<string> {
    const { toPhone, orderNumber, jerseyTitle, size, totalAmount, currency, paymentUrl } = options;
    const formattedAmount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(totalAmount);

    const bodyText = [
      `🧾 *ORDER RESERVED: #${orderNumber}*`,
      ``,
      `⚽ *${jerseyTitle}*`,
      `📏 Size: *${size}*`,
      `💰 Total: *${formattedAmount}*`,
      ``,
      `⏳ *Stock Hold:* Reserved for *15 minutes*.`,
      `💳 Tap below to complete your payment:`
    ].join('\n');

    const messageId = await whatsappService.sendInteractiveMessage(organizationId, {
      toPhone,
      body: bodyText,
      footer: 'Secured by Paystack',
      action: {
        type: 'cta_url',
        displayText: '💳 Pay Now',
        url: paymentUrl
      }
    });

    const savedMessage = await chatRepository.insertMessage(organizationId, {
      conversationId,
      metaMessageId: messageId,
      direction: 'outbound',
      type: 'payment_link',
      body: `🧾 Order #${orderNumber} (${currency} ${totalAmount}) - ${paymentUrl}`,
      deliveryStatus: 'sent'
    });

    if (savedMessage) {
      socketService.emitNewMessage(organizationId, savedMessage);
      const updatedConv = await chatRepository.getConversationById(organizationId, conversationId);
      if (updatedConv) {
        socketService.emitConversationUpdated(organizationId, updatedConv);
      }
    }

    return messageId;
  },

  /**
   * Sends a friendly handover message confirming human support connection.
   */
  async sendHumanSupportHandover(
    organizationId: string,
    conversationId: string,
    options: { toPhone: string }
  ): Promise<string> {
    const body =
      "👨‍💼 *A Human Support Agent has been notified!*\n\nOur team is reviewing your chat and will respond here shortly. Feel free to type any specific questions or instructions below.";

    const messageId = await whatsappService.sendTextMessage(organizationId, {
      toPhone: options.toPhone,
      body
    });

    const savedMessage = await chatRepository.insertMessage(organizationId, {
      conversationId,
      metaMessageId: messageId,
      direction: 'outbound',
      type: 'text',
      body,
      deliveryStatus: 'sent'
    });

    if (savedMessage) {
      socketService.emitNewMessage(organizationId, savedMessage);
      const updatedConv = await chatRepository.getConversationById(organizationId, conversationId);
      if (updatedConv) {
        socketService.emitConversationUpdated(organizationId, updatedConv);
      }
    }

    return messageId;
  },

  /**
   * Authoritative, centralized checkout pipeline:
   * 1. Idempotency Guard: Re-uses active pending order with paymentUrl if customer retries or double-taps.
   * 2. Atomic Order & Reservation: Locks stock and creates 15-minute hold via ordersService.
   * 3. Paystack Transaction Initialization: Creates secure payment link.
   * 4. Session State Update: Transitions conversation to awaiting_payment.
   * 5. Interactive WhatsApp Card: Dispatches official Paystack payment link card.
   */
  async executeCheckout(
    organizationId: string,
    conversationId: string,
    options: {
      customerPhone: string;
      jerseyId: string;
      size: JerseySize;
      quantity?: number;
      customName?: string;
      customNumber?: string;
      shippingAddress?: string;
    }
  ): Promise<{ order: OrderRecord; paymentUrl: string; isExisting: boolean }> {
    const quantity = options.quantity && options.quantity > 0 ? options.quantity : 1;
    const normalizedPhone = formatPhoneNumber(options.customerPhone);

    // 1. Idempotency Check: Existing active order with active reservation & paymentUrl
    const existingActiveOrder = await prisma.order.findFirst({
      where: {
        organizationId,
        paymentStatus: 'pending',
        fulfillmentStatus: 'unfulfilled',
        paymentUrl: { not: null },
        reservationExpiresAt: { gt: new Date() },
        customer: {
          phoneNumber: normalizedPhone
        },
        orderItems: {
          some: {
            jerseyId: options.jerseyId,
            size: options.size
          }
        }
      },
      include: {
        customer: {
          select: { phoneNumber: true, displayName: true }
        },
        orderItems: {
          include: {
            jersey: { select: { title: true, imageUrl: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (existingActiveOrder && existingActiveOrder.paymentUrl) {
      console.log(
        `[CommerceEngine] Idempotent hit: Reusing existing pending Order #${existingActiveOrder.orderNumber} for ${options.customerPhone}`
      );

      const record: OrderRecord = {
        id: existingActiveOrder.id,
        organizationId: existingActiveOrder.organizationId,
        orderNumber: existingActiveOrder.orderNumber,
        customerId: existingActiveOrder.customerId,
        subtotal: Number(existingActiveOrder.subtotal),
        shippingFee: Number(existingActiveOrder.shippingFee),
        totalAmount: Number(existingActiveOrder.totalAmount),
        currency: existingActiveOrder.currency,
        paymentStatus: existingActiveOrder.paymentStatus as PaymentStatus,
        fulfillmentStatus: existingActiveOrder.fulfillmentStatus as FulfillmentStatus,
        paystackReference: existingActiveOrder.paystackReference,
        paystackAccessCode: existingActiveOrder.paystackAccessCode,
        paymentUrl: existingActiveOrder.paymentUrl,
        reservationExpiresAt: existingActiveOrder.reservationExpiresAt
          ? existingActiveOrder.reservationExpiresAt.toISOString()
          : null,
        shippingAddress: existingActiveOrder.shippingAddress,
        shippingTrackingNumber: existingActiveOrder.shippingTrackingNumber,
        notes: existingActiveOrder.notes,
        createdAt: existingActiveOrder.createdAt.toISOString(),
        updatedAt: existingActiveOrder.updatedAt.toISOString(),
        customerPhone: existingActiveOrder.customer?.phoneNumber,
        customerName: existingActiveOrder.customer?.displayName ?? undefined,
        items: (existingActiveOrder.orderItems || []).map((item) => ({
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

      // Resend checkout card to WhatsApp so customer has the button in front of them
      await this.sendCheckoutCard(organizationId, conversationId, {
        toPhone: options.customerPhone,
        orderNumber: existingActiveOrder.orderNumber,
        jerseyTitle: existingActiveOrder.orderItems[0]?.jersey?.title || 'Jersey',
        size: options.size,
        totalAmount: Number(existingActiveOrder.totalAmount),
        currency: existingActiveOrder.currency,
        paymentUrl: existingActiveOrder.paymentUrl
      });

      return {
        order: record,
        paymentUrl: existingActiveOrder.paymentUrl,
        isExisting: true
      };
    }

    // 2. Validate jersey and inventory
    const jersey = await catalogService.getJersey(organizationId, options.jerseyId);
    if (!jersey || !jersey.isActive) {
      throw new Error(`This jersey is no longer active in our store.`);
    }

    const stockCheck = await catalogService.isSizeAvailable(
      organizationId,
      options.jerseyId,
      options.size,
      quantity
    );

    if (!stockCheck.available) {
      await this.sendSizePicker(organizationId, conversationId, {
        toPhone: options.customerPhone,
        jersey
      });
      throw new Error(
        `Size ${options.size} for "${jersey.title}" is currently out of stock. Please select from available sizes.`
      );
    }

    // 3. Atomic Order & Reservation Creation (15-min lock)
    const order = await ordersService.createOrder(organizationId, {
      customerPhone: options.customerPhone,
      shippingAddress: options.shippingAddress,
      items: [
        {
          jerseyId: options.jerseyId,
          size: options.size,
          quantity,
          customName: options.customName,
          customNumber: options.customNumber
        }
      ]
    });

    // 4. Initialize Paystack Transaction
    let paymentInit: { authorizationUrl: string; accessCode: string; reference: string };
    try {
      const customerEmail = `${options.customerPhone.replace(/\+/g, '')}@whatsapp.customer`;
      paymentInit = await paymentsService.initializePayment(
        organizationId,
        order.id,
        customerEmail
      );
    } catch (paystackError: unknown) {
      console.error(
        `[CommerceEngine] Paystack initialization failed for order ${order.id}. Releasing reserved stock:`,
        paystackError
      );
      await ordersService.cancelOrderAndReleaseStock(organizationId, order.id);
      throw paystackError;
    }

    // 5. Update Conversation State (active commerce fields only)
    await conversationStateService.updateState(organizationId, conversationId, {
      stage: 'awaiting_payment',
      jerseyId: jersey.id,
      team: jersey.team,
      kitType: jersey.kitType,
      size: options.size,
      quantity,
      orderId: order.id
    });

    // 6. Send Checkout Card
    await this.sendCheckoutCard(organizationId, conversationId, {
      toPhone: options.customerPhone,
      orderNumber: order.orderNumber,
      jerseyTitle: jersey.title,
      size: options.size,
      totalAmount: order.totalAmount,
      currency: order.currency,
      paymentUrl: paymentInit.authorizationUrl
    });

    return {
      order,
      paymentUrl: paymentInit.authorizationUrl,
      isExisting: false
    };
  }
};
