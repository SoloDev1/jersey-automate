import { whatsappService } from './whatsapp.service.js';
import { whatsappActions } from './whatsapp-actions.js';
import { JerseyRecord, JerseySize } from '../catalog/catalog.types.js';
import { chatRepository } from '../chat/chat.repository.js';
import { socketService } from '../../core/socket/socket.service.js';

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
  }
};
