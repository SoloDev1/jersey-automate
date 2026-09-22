import { ToolDefinition } from './ai.types.js';
import { catalogService } from '../catalog/catalog.service.js';
import { ordersService } from '../orders/orders.service.js';
import { paymentsService } from '../payments/payments.service.js';
import { JerseySize } from '../catalog/catalog.types.js';
import { supabase } from '../../core/database/supabase.js';
import { whatsappService } from '../whatsapp/whatsapp.service.js';
import { chatRepository } from '../chat/chat.repository.js';

export const AI_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_catalog',
      description: 'Search store catalog for football jerseys. Photos are automatically delivered to WhatsApp. Always supply team name (e.g. "Manchester United") and kitType (e.g. "Home") if requested by customer.',
      parameters: {
        type: 'object',
        properties: {
          team: {
            type: 'string',
            description: 'The club or national team name (e.g. "Manchester United", "Arsenal", "Real Madrid"). Retain the active club from prior messages if the customer asks a follow-up like "send me the home kit" or "what about the away".'
          },
          kitType: {
            type: 'string',
            enum: ['Home', 'Away', 'Third', 'Fourth', 'Goalkeeper'],
            description: 'Specific kit type if requested by customer (e.g. "Home", "Away", "Third"). Use this whenever the customer asks for a specific kit type like "home kit", "away kit", etc.'
          },
          league: {
            type: 'string',
            description: 'Optional league name (e.g. "Premier League", "La Liga", "Serie A")'
          },
          season: {
            type: 'string',
            description: 'Optional season (e.g. "2026/27")'
          },
          query: {
            type: 'string',
            description: 'Optional general keyword fallback'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_stock',
      description: 'Check real-time physical size availability (XS, S, M, L, XL, XXL, 3XL) for a jersey.',
      parameters: {
        type: 'object',
        properties: {
          jerseyId: {
            type: 'string',
            description: 'The UUID identifier of the jersey'
          }
        },
        required: ['jerseyId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_checkout',
      description: 'Create an order with an atomic 15-minute stock hold and generate a secure Paystack payment link.',
      parameters: {
        type: 'object',
        properties: {
          jerseyId: {
            type: 'string',
            description: 'The UUID of the jersey the customer wants to buy'
          },
          size: {
            type: 'string',
            enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
            description: 'The chosen jersey size'
          },
          quantity: {
            type: 'integer',
            description: 'Quantity to order (default 1)'
          },
          customName: {
            type: 'string',
            description: 'Optional name to print on back of shirt (e.g. "BELLINGHAM", "MESSI")'
          },
          customNumber: {
            type: 'string',
            description: 'Optional shirt number to print (e.g. "5", "10")'
          },
          shippingAddress: {
            type: 'string',
            description: 'Customer delivery address if provided'
          }
        },
        required: ['jerseyId', 'size']
      }
    }
  }
];

export const toolHandlers = {
  /**
   * Catalog search tool handler.
   * Automatically dispatches official photo cards directly to WhatsApp for top matching jerseys.
   */
  async search_catalog(
    organizationId: string,
    conversationId: string,
    customerPhone: string,
    args: { team?: string; kitType?: string; league?: string; season?: string; query?: string }
  ): Promise<any> {
    const effectiveTeam = args.team || args.query;
    const effectiveKitType = args.kitType;

    const result = await catalogService.getCatalog(organizationId, {
      team: args.team,
      kitType: effectiveKitType,
      league: args.league,
      season: args.season,
      search: args.query,
      limit: effectiveKitType ? 2 : 4
    });

    if (result.data.length === 0) {
      // If a specific kitType was requested (e.g. "Home"), check if the team exists with other kits!
      if (effectiveTeam && effectiveKitType) {
        const teamCheck = await catalogService.getCatalog(organizationId, {
          team: effectiveTeam,
          limit: 5
        });

        if (teamCheck.data.length > 0) {
          const availableTypes = [...new Set(teamCheck.data.map((j) => j.kitType))];
          return {
            found: false,
            reason: 'SPECIFIC_KIT_TYPE_UNAVAILABLE',
            requestedKitType: effectiveKitType,
            availableKitTypes: availableTypes,
            team: teamCheck.data[0].team,
            instruction: `We do not carry the ${effectiveKitType} kit for ${teamCheck.data[0].team}. However, we DO have the ${availableTypes.join(', ')} kit(s) available. Truthfully tell the customer this and ask if they would like to see one of the available kits.`
          };
        }
      }

      return {
        found: false,
        reason: 'NOT_FOUND',
        message: `No jerseys found matching the request. Truthfully tell the customer we do not have this in stock and ask if they would like another team.`
      };
    }

    // Retrieve store currency
    const { data: settings } = await supabase
      .from('settings')
      .select('currency')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const currency = settings?.currency || 'NGN';

    // If customer requested a specific kit type (e.g. Home), dispatch ONLY that single photo card
    const maxPhotos = effectiveKitType ? 1 : Math.min(result.data.length, 3);
    const topMatches = result.data.slice(0, maxPhotos);
    const sentPhotos: string[] = [];

    for (const jersey of topMatches) {
      if (jersey.imageUrl && customerPhone) {
        try {
          const metaMessageId = await whatsappService.sendKitCard(organizationId, {
            toPhone: customerPhone,
            jerseyTitle: jersey.title,
            imageUrl: jersey.imageUrl,
            price: jersey.basePrice,
            currency,
            description: jersey.description
          });

          await chatRepository.insertMessage(organizationId, {
            conversationId,
            metaMessageId,
            direction: 'outbound',
            type: 'interactive_kit',
            body: `⚽ ${jersey.title} - ${currency} ${jersey.basePrice}`,
            mediaUrl: jersey.imageUrl,
            jerseyId: jersey.id,
            deliveryStatus: 'sent'
          });

          sentPhotos.push(jersey.title);
        } catch (photoErr: any) {
          console.warn(`[search_catalog] Could not send photo card for ${jersey.title}:`, photoErr?.message);
        }
      }
    }

    return {
      found: true,
      count: result.data.length,
      photosSentAbove: sentPhotos,
      jerseys: result.data.map((j) => ({
        id: j.id,
        title: j.title,
        team: j.team,
        league: j.league,
        season: j.season,
        kitType: j.kitType,
        price: j.basePrice,
        availableSizes: j.inventory
          ?.filter((inv) => inv.quantityAvailable > 0)
          .map((inv) => inv.size)
      })),
      instruction: 'The official photo card(s) have ALREADY been delivered directly to the customer as real WhatsApp photo cards above! Do NOT output any links, URLs, or markdown links. Confirm you sent the photo above, mention the kit(s), prices, and available sizes, and ask what size they need.'
    };
  },

  /**
   * Safe read-only stock check tool handler.
   */
  async check_stock(
    organizationId: string,
    args: { jerseyId: string }
  ): Promise<any> {
    try {
      const jersey = await catalogService.getJersey(organizationId, args.jerseyId);
      if (!jersey) {
        return { error: 'Jersey not found' };
      }

      const inventory = jersey.inventory || [];
      const inStockSizes = inventory
        .filter((s) => s.quantityAvailable > 0)
        .map((s) => `${s.size} (${s.quantityAvailable} available)`);

      return {
        jerseyTitle: jersey.title,
        price: jersey.basePrice,
        inStockSizes,
        allSizes: inventory.map((s) => ({
          size: s.size,
          available: s.quantityAvailable
        }))
      };
    } catch (error: any) {
      return { error: error.message || 'Failed to check stock' };
    }
  },

  /**
   * Mutating checkout tool handler.
   * Atomic 15-minute stock hold + Paystack checkout link creation + clean WhatsApp payment card delivery.
   */
  async create_checkout(
    organizationId: string,
    conversationId: string,
    customerPhone: string,
    args: {
      jerseyId: string;
      size: JerseySize;
      quantity?: number;
      customName?: string;
      customNumber?: string;
      shippingAddress?: string;
    }
  ): Promise<any> {
    try {
      const quantity = args.quantity && args.quantity > 0 ? args.quantity : 1;

      // 1. Create order (Server pricing authority + atomic 15-min reservation)
      const order = await ordersService.createOrder(organizationId, {
        customerPhone,
        shippingAddress: args.shippingAddress,
        items: [
          {
            jerseyId: args.jerseyId,
            size: args.size,
            quantity,
            customName: args.customName,
            customNumber: args.customNumber
          }
        ]
      });

      // 2. Initialize Paystack payment
      const paymentInit = await paymentsService.initializePayment(
        organizationId,
        order.id,
        `${customerPhone.replace(/\+/g, '')}@whatsapp.customer`
      );

      // 3. Fetch jersey details for invoice summary
      const jersey = await catalogService.getJersey(organizationId, args.jerseyId);

      // 4. Format clean, high-converting WhatsApp checkout message
      const formattedAmount = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: order.currency
      }).format(order.totalAmount);

      const customPrint = [args.customName, args.customNumber ? `#${args.customNumber}` : '']
        .filter(Boolean)
        .join(' ');

      const checkoutCard = [
        `🧾 *ORDER CONFIRMATION & CHECKOUT*`,
        ``,
        `Your kit has been held for *15 minutes* ⏳`,
        ``,
        `⚽ *Item:* ${jersey?.title || 'Football Kit'}`,
        `📏 *Size:* *${args.size}* (Qty: ${quantity})`,
        customPrint ? `🔢 *Custom Print:* ${customPrint}` : '',
        args.shippingAddress ? `🚚 *Delivery To:* ${args.shippingAddress}` : '',
        ``,
        `─────────────────────────`,
        `💰 *Total Amount:* *${formattedAmount}*`,
        `─────────────────────────`,
        ``,
        `Tap the secure Paystack link below to complete payment:`,
        `👉 ${paymentInit.authorizationUrl}`,
        ``,
        `🔒 _Supports Debit Cards, Bank Transfer & USSD._`
      ]
        .filter(Boolean)
        .join('\n');

      // 5. Automatically dispatch clean checkout message via WhatsApp Cloud API
      const metaMessageId = await whatsappService.sendTextMessage(organizationId, {
        toPhone: customerPhone,
        body: checkoutCard
      });

      // 6. Record checkout message in CRM chat thread
      await chatRepository.insertMessage(organizationId, {
        conversationId,
        metaMessageId,
        direction: 'outbound',
        type: 'payment_link',
        body: checkoutCard,
        deliveryStatus: 'sent'
      });

      return {
        success: true,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        currency: order.currency,
        checkoutUrl: paymentInit.authorizationUrl,
        checkoutCardSentAbove: true,
        instruction: 'The complete order confirmation and secure Paystack payment link have ALREADY been delivered directly to the customer above! Do NOT re-paste the URL or generate links. Simply confirm you sent the checkout link above, remind them their kit is reserved for 15 minutes, and invite them to complete payment.'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create checkout link. The requested size may be out of stock.'
      };
    }
  }
};
