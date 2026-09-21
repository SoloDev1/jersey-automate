import { ToolDefinition } from './ai.types.js';
import { catalogService } from '../catalog/catalog.service.js';
import { ordersService } from '../orders/orders.service.js';
import { paymentsService } from '../payments/payments.service.js';
import { JerseySize } from '../catalog/catalog.types.js';

export const AI_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_catalog',
      description: 'Search store catalog for football jerseys by team, club, country, league, kit type, or season.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keywords to search (e.g. "Arsenal", "Real Madrid", "Barcelona home jersey", "Nigeria 2024")'
          },
          league: {
            type: 'string',
            description: 'Optional league name (e.g. "Premier League", "La Liga", "Serie A")'
          },
          kitType: {
            type: 'string',
            description: 'Optional kit type (e.g. "Home", "Away", "Third")'
          }
        },
        required: ['query']
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
   * Safe read-only catalog search tool handler.
   */
  async search_catalog(
    organizationId: string,
    args: { query: string; league?: string; kitType?: string }
  ): Promise<any> {
    const result = await catalogService.getCatalog(organizationId, {
      search: args.query,
      league: args.league,
      kitType: args.kitType,
      limit: 5
    });

    if (result.data.length === 0) {
      return {
        found: false,
        message: `No jerseys found matching "${args.query}". Ask the customer if they would like another team or season.`
      };
    }

    return {
      found: true,
      count: result.data.length,
      jerseys: result.data.map((j) => ({
        id: j.id,
        title: j.title,
        team: j.team,
        league: j.league,
        season: j.season,
        kitType: j.kitType,
        price: j.basePrice,
        imageUrl: j.imageUrl,
        availableSizes: j.inventory
          ?.filter((inv) => inv.quantityAvailable > 0)
          .map((inv) => inv.size)
      }))
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
   * Atomic 15-minute stock hold + Paystack checkout link creation.
   */
  async create_checkout(
    organizationId: string,
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

      return {
        success: true,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        currency: order.currency,
        checkoutUrl: paymentInit.authorizationUrl,
        expiresInMinutes: 15,
        message: 'Order created and stock held for 15 minutes.'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create checkout link. The requested size may be out of stock.'
      };
    }
  }
};
