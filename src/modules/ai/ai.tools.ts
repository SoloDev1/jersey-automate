import { ToolDefinition } from './ai.types.js';
import { catalogService } from '../catalog/catalog.service.js';
import { ordersService } from '../orders/orders.service.js';
import { paymentsService } from '../payments/payments.service.js';
import { UpdateOrderAddressResult } from '../orders/orders.types.js';
import { JerseySize, JerseyRecord, JerseyInventoryRecord } from '../catalog/catalog.types.js';
import { prisma } from '../../core/database/prisma.js';
import { whatsappService } from '../whatsapp/whatsapp.service.js';
import { chatRepository } from '../chat/chat.repository.js';
import { socketService } from '../../core/socket/socket.service.js';

// In-memory idempotency cache for mutating tool calls (TTL 10 mins, Max 2,000 entries)
const mutatingToolCache = new Map<string, { result: unknown; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_SIZE = 2000;

function sweepExpiredCacheEntries(): void {
  const now = Date.now();
  for (const [key, entry] of mutatingToolCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      mutatingToolCache.delete(key);
    }
  }
}

// Background cleanup every 5 minutes; unref() prevents blocking process termination
const cleanupInterval = setInterval(sweepExpiredCacheEntries, 5 * 60 * 1000);
if (typeof cleanupInterval.unref === 'function') {
  cleanupInterval.unref();
}

function getCachedResult<T>(idempotencyKey?: string): T | null {
  if (!idempotencyKey) return null;
  const entry = mutatingToolCache.get(idempotencyKey);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    mutatingToolCache.delete(idempotencyKey);
    return null;
  }
  return entry.result as T;
}

function setCachedResult(idempotencyKey: string | undefined, result: unknown): void {
  if (!idempotencyKey) return;
  // If cache exceeds size cap, sweep expired items or evict oldest
  if (mutatingToolCache.size >= MAX_CACHE_SIZE) {
    sweepExpiredCacheEntries();
    if (mutatingToolCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = mutatingToolCache.keys().next().value;
      if (oldestKey !== undefined) {
        mutatingToolCache.delete(oldestKey);
      }
    }
  }
  mutatingToolCache.set(idempotencyKey, { result, timestamp: Date.now() });
}

export interface SearchCatalogResult {
  found: boolean;
  reason?: 'SPECIFIC_KIT_TYPE_UNAVAILABLE' | 'NOT_FOUND';
  requestedKitType?: string;
  availableKitTypes?: string[];
  team?: string;
  count?: number;
  jerseys?: Array<{
    id: string;
    title: string;
    team: string;
    league: string;
    season: string;
    kitType: string;
    price: number;
    availableSizes?: JerseySize[];
    imageUrl?: string;
    description?: string | null;
  }>;
  instruction: string;
  message?: string;
}

export interface CheckStockResult {
  jerseyTitle?: string;
  price?: number;
  inStockSizes?: string[];
  allSizes?: Array<{
    size: JerseySize;
    available: number;
  }>;
  error?: string;
}

export interface SendProductMediaResult {
  success: boolean;
  jerseyTitle?: string;
  imageUrl?: string;
  instruction: string;
  error?: string;
}

export interface ShowProductResult {
  found: boolean;
  photoSent?: boolean;
  jerseyId?: string;
  title?: string;
  team?: string;
  kitType?: string;
  price?: number;
  currency?: string;
  availableSizes?: JerseySize[];
  instruction: string;
  error?: string;
}

export interface CreateCheckoutResult {
  success: boolean;
  orderNumber?: number;
  totalAmount?: number;
  currency?: string;
  checkoutUrl?: string;
  checkoutCardSentAbove?: boolean;
  instruction?: string;
  error?: string;
}

export interface CheckOrderStatusResult {
  found: boolean;
  orderNumber?: number;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  shippingTrackingNumber?: string | null;
  items?: Array<{
    title?: string;
    size: string;
    quantity: number;
  }>;
  totalAmount?: number;
  currency?: string;
  createdAt?: string;
  instruction: string;
}

export const AI_TOOLS: ToolDefinition[] = [
  // ── 1. COMPOSITE DETERMINISTIC TOOL: show_product ──────────────────────────
  {
    type: 'function',
    function: {
      name: 'show_product',
      description: 'Resolves football kit details (price, in-stock sizes, info) and automatically sends the official high-resolution photo card to the customer on WhatsApp if requested. Use this whenever the customer asks to see a kit, view a photo, asks about available kits, or asks about prices/sizes.',
      parameters: {
        type: 'object',
        properties: {
          team: {
            type: 'string',
            description: 'The club or team name (e.g. "Arsenal", "Real Madrid", "Chelsea"). Retain active team from conversation.'
          },
          kitType: {
            type: 'string',
            enum: ['Home', 'Away', 'Third', 'Fourth', 'Goalkeeper'],
            description: 'Specific kit type (e.g. "Home", "Away", "Third"). Defaults to "Home" if unspecified.'
          },
          jerseyId: {
            type: 'string',
            description: 'Optional jersey UUID if already known from prior context.'
          },
          sendPhoto: {
            type: 'boolean',
            description: 'Set to true to dispatch the high-resolution photo card directly into the customer WhatsApp chat. Defaults to true when customer asks to see, view, or get photo.'
          }
        },
        required: ['team']
      }
    }
  },

  // ── 2. READ TOOL: search_catalog (Side-effect free) ─────────────────────────
  {
    type: 'function',
    function: {
      name: 'search_catalog',
      description: 'Side-effect free catalog search. Finds matching football jerseys by club, team, kit type, or league. Does NOT send WhatsApp media.',
      parameters: {
        type: 'object',
        properties: {
          team: {
            type: 'string',
            description: 'The club or national team name (e.g. "Manchester United", "Arsenal", "Real Madrid"). Retain active club from prior messages.'
          },
          kitType: {
            type: 'string',
            enum: ['Home', 'Away', 'Third', 'Fourth', 'Goalkeeper'],
            description: 'Specific kit type if requested by customer (e.g. "Home", "Away", "Third").'
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

  // ── 2. READ TOOL: check_stock (Side-effect free) ───────────────────────────
  {
    type: 'function',
    function: {
      name: 'check_stock',
      description: 'Side-effect free stock inquiry. Checks authoritative per-size inventory levels for a specific jersey UUID.',
      parameters: {
        type: 'object',
        properties: {
          jerseyId: {
            type: 'string',
            description: 'The unique UUID of the jersey from search_catalog.'
          }
        },
        required: ['jerseyId']
      }
    }
  },

  // ── 3. READ TOOL: check_order_status (Side-effect free) ────────────────────
  {
    type: 'function',
    function: {
      name: 'check_order_status',
      description: 'Side-effect free order lookup. Checks payment and fulfillment status for an existing order by number or phone.',
      parameters: {
        type: 'object',
        properties: {
          orderNumber: {
            type: 'number',
            description: 'Optional 5-digit order number provided by customer.'
          }
        }
      }
    }
  },

  // ── 4. MUTATING TOOL: send_product_media (Sends WhatsApp Photo Card) ────────
  {
    type: 'function',
    function: {
      name: 'send_product_media',
      description: 'Sends an official high-resolution photo card of a specific jersey directly to the customer WhatsApp thread.',
      parameters: {
        type: 'object',
        properties: {
          jerseyId: {
            type: 'string',
            description: 'The unique UUID of the jersey to send if known.'
          },
          team: {
            type: 'string',
            description: 'The club or team name (e.g. "Arsenal", "Real Madrid").'
          },
          kitType: {
            type: 'string',
            enum: ['Home', 'Away', 'Third', 'Fourth', 'Goalkeeper'],
            description: 'Specific kit type (e.g. "Home", "Away"). Defaults to "Home".'
          }
        }
      }
    }
  },

  // ── 5. MUTATING TOOL: create_checkout (Holds Stock & Creates Paystack Link) ──
  {
    type: 'function',
    function: {
      name: 'create_checkout',
      description: 'Creates an official order, locks inventory with a 15-minute reservation hold, and delivers a secure Paystack payment link to WhatsApp.',
      parameters: {
        type: 'object',
        properties: {
          jerseyId: {
            type: 'string',
            description: 'The unique UUID of the jersey to purchase if known.'
          },
          team: {
            type: 'string',
            description: 'The club or team name (e.g. "Arsenal", "Real Madrid") if jerseyId is unknown.'
          },
          kitType: {
            type: 'string',
            enum: ['Home', 'Away', 'Third', 'Fourth', 'Goalkeeper'],
            description: 'Specific kit type (e.g. "Home", "Away") if jerseyId is unknown. Defaults to "Home".'
          },
          size: {
            type: 'string',
            enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
            description: 'The specific size selected by the customer.'
          },
          quantity: {
            type: 'number',
            description: 'Number of jerseys to buy (default 1).'
          },
          customName: {
            type: 'string',
            description: 'Optional player name or custom text to print on back.'
          },
          customNumber: {
            type: 'string',
            description: 'Optional shirt squad number to print on back.'
          },
          shippingAddress: {
            type: 'string',
            description: 'Optional customer delivery address.'
          }
        },
        required: ['size']
      }
    }
  },

  // ── 6. MUTATING TOOL: update_order_shipping_address ─────────────────────────
  {
    type: 'function',
    function: {
      name: 'update_order_shipping_address',
      description: 'Updates the delivery shipping address and/or delivery instructions for a customer order. Strictly rejected if the order has already shipped or handed to courier.',
      parameters: {
        type: 'object',
        properties: {
          shippingAddress: {
            type: 'string',
            description: 'The new delivery address provided by the customer.'
          },
          orderNumber: {
            type: 'string',
            description: 'Optional 5-digit order number (e.g. "10042" or "#10042"). If omitted, the customer\'s latest active order will be updated.'
          },
          deliveryNotes: {
            type: 'string',
            description: 'Optional delivery notes or instructions (e.g. "Leave with security at gate 2", "Call upon arrival").'
          }
        },
        required: ['shippingAddress']
      }
    }
  }
];

export const toolHandlers = {
  /**
   * 1. READ TOOL: search_catalog (Pure search, zero side-effects)
   */
  async search_catalog(
    organizationId: string,
    filter: {
      team?: string;
      kitType?: string;
      league?: string;
      season?: string;
      query?: string;
    }
  ): Promise<SearchCatalogResult> {
    const effectiveTeam = filter.team?.trim();
    const effectiveKitType = filter.kitType?.trim();

    const searchParams = {
      team: effectiveTeam || undefined,
      kitType: effectiveKitType || undefined,
      league: filter.league?.trim() || undefined,
      season: filter.season?.trim() || undefined,
      query: filter.query?.trim() || undefined,
      inStock: true,
      limit: 6
    };

    const result = await catalogService.getCatalog(organizationId, searchParams);

    if (result.data.length === 0) {
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
        instruction: 'No jerseys found matching the request. Truthfully tell the customer we do not have this in stock and ask if they would like another team.',
        message: 'No jerseys found matching the request.'
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
        availableSizes: j.inventory
          ?.filter((inv) => inv.quantityAvailable > 0)
          .map((inv) => inv.size),
        imageUrl: j.imageUrl,
        description: j.description
      })),
      instruction: 'Mention the matching kit(s), prices, and available sizes. If the customer wants to see a picture, you can offer to send a photo using send_product_media.'
    };
  },

  /**
   * 2. READ TOOL: check_stock (Authoritative size availability)
   */
  async check_stock(
    organizationId: string,
    args: { jerseyId?: string }
  ): Promise<CheckStockResult> {
    if (!args.jerseyId) {
      return { error: 'Missing jerseyId' };
    }

    try {
      const jersey = await catalogService.getJersey(organizationId, args.jerseyId);
      if (!jersey) {
        return { error: 'Jersey not found' };
      }

      const inStockSizes = (jersey.inventory || [])
        .filter((inv) => inv.quantityAvailable > 0)
        .map((inv) => inv.size);

      return {
        jerseyTitle: jersey.title,
        price: jersey.basePrice,
        inStockSizes,
        allSizes: (jersey.inventory || []).map((s) => ({
          size: s.size,
          available: s.quantityAvailable
        }))
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to check stock';
      return { error: msg };
    }
  },

  /**
   * 3. READ TOOL: check_order_status (Authoritative order fulfillment status)
   */
  async check_order_status(
    organizationId: string,
    customerPhone: string,
    args: { orderNumber?: number }
  ): Promise<CheckOrderStatusResult> {
    try {
      let order = null;
      if (args.orderNumber) {
        order = await ordersService.getOrderByNumber(organizationId, args.orderNumber);
      }
      if (!order && customerPhone) {
        order = await ordersService.getLatestOrderByCustomerPhone(organizationId, customerPhone);
      }

      if (!order) {
        return {
          found: false,
          instruction: 'No order was found matching that order number or phone. Truthfully ask the customer for their order number.'
        };
      }

      return {
        found: true,
        orderNumber: order.orderNumber,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        shippingTrackingNumber: order.shippingTrackingNumber,
        items: (order.items || []).map((i) => ({
          title: i.jerseyTitle,
          size: i.size,
          quantity: i.quantity
        })),
        totalAmount: order.totalAmount,
        currency: order.currency,
        createdAt: order.createdAt,
        instruction: `Order #${order.orderNumber} status: Payment is "${order.paymentStatus}", Fulfillment is "${order.fulfillmentStatus}".${order.shippingTrackingNumber ? ` Tracking number: ${order.shippingTrackingNumber}.` : ''} Truthfully summarize this to the customer.`
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Database error';
      return {
        found: false,
        instruction: `Could not retrieve order details: ${msg}. Ask customer to verify their order number.`
      };
    }
  },

  /**
   * 0. COMPOSITE DETERMINISTIC TOOL: show_product (Resolves jersey, checks sizes, and dispatches photo card)
   */
  async show_product(
    organizationId: string,
    conversationId: string,
    customerPhone: string,
    args: {
      team: string;
      kitType?: string;
      jerseyId?: string;
      sendPhoto?: boolean;
      idempotencyKey?: string;
    }
  ): Promise<ShowProductResult> {
    const cached = getCachedResult<ShowProductResult>(args.idempotencyKey);
    if (cached) return cached;

    try {
      let jersey: JerseyRecord | null = null;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      if (args.jerseyId && uuidRegex.test(args.jerseyId)) {
        jersey = await catalogService.getJersey(organizationId, args.jerseyId);
      }

      if (!jersey && args.team) {
        const searchRes = await catalogService.getCatalog(organizationId, {
          team: args.team,
          kitType: args.kitType || 'Home',
          limit: 1
        });
        jersey = searchRes.data[0] || null;

        // If specific kitType not found, search general team to offer alternatives
        if (!jersey && args.kitType) {
          const fallbackRes = await catalogService.getCatalog(organizationId, {
            team: args.team,
            limit: 4
          });
          if (fallbackRes.data.length > 0) {
            const availableTypes = fallbackRes.data.map((j) => j.kitType);
            const res: ShowProductResult = {
              found: false,
              instruction: `We do not currently have the ${args.team} ${args.kitType} kit in stock. However, we do have the ${availableTypes.join(', ')} kit(s). Inform the customer politely and ask if they would like to see one of those.`
            };
            setCachedResult(args.idempotencyKey, res);
            return res;
          }
        }
      }

      if (!jersey) {
        const res: ShowProductResult = {
          found: false,
          instruction: `No active jersey found for "${args.team}". Tell the customer we don't carry that club right now, and suggest our top available clubs (Premier League clubs, Real Madrid, Barcelona, PSG, Bayern Munich, Dortmund, Juventus, etc.).`
        };
        setCachedResult(args.idempotencyKey, res);
        return res;
      }

      const setting = await prisma.setting.findUnique({
        where: { organizationId },
        select: { currency: true }
      });
      const currency = setting?.currency || 'NGN';

      const availableSizes: JerseySize[] = (jersey.inventory || [])
        .filter((inv: JerseyInventoryRecord) => inv.quantityAvailable > 0)
        .map((inv: JerseyInventoryRecord) => inv.size);

      let photoSent = false;
      const shouldSendPhoto = args.sendPhoto !== false;

      if (shouldSendPhoto && jersey.imageUrl) {
        try {
          const metaMessageId = await whatsappService.sendKitCard(organizationId, {
            toPhone: customerPhone,
            jerseyTitle: jersey.title,
            imageUrl: jersey.imageUrl,
            price: jersey.basePrice,
            currency,
            description: jersey.description
          });

          const savedKitMessage = await chatRepository.insertMessage(organizationId, {
            conversationId,
            metaMessageId,
            direction: 'outbound',
            type: 'interactive_kit',
            body: `⚽ ${jersey.title} - ${currency} ${jersey.basePrice}`,
            mediaUrl: jersey.imageUrl,
            jerseyId: jersey.id,
            deliveryStatus: 'sent'
          });

          if (savedKitMessage) {
            socketService.emitNewMessage(organizationId, savedKitMessage);
            const updatedConv = await chatRepository.getConversationById(organizationId, conversationId);
            if (updatedConv) {
              socketService.emitConversationUpdated(organizationId, updatedConv);
            }
          }
          photoSent = true;
        } catch (mediaErr: unknown) {
          const msg = mediaErr instanceof Error ? mediaErr.message : 'Media dispatch error';
          console.warn(`[show_product] Photo dispatch issue for ${jersey.title}:`, msg);
        }
      }

      const instruction = photoSent
        ? `The official photo card has been sent above to customer on WhatsApp! State the price (${currency} ${jersey.basePrice}) and available sizes (${availableSizes.join(', ')}). Ask what size they want.`
        : `Found ${jersey.title} (${currency} ${jersey.basePrice}). Available sizes: ${availableSizes.join(', ')}. Inform the customer.`;

      const response: ShowProductResult = {
        found: true,
        photoSent,
        jerseyId: jersey.id,
        title: jersey.title,
        team: jersey.team,
        kitType: jersey.kitType,
        price: jersey.basePrice,
        currency,
        availableSizes,
        instruction
      };

      setCachedResult(args.idempotencyKey, response);
      return response;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Product lookup error';
      return {
        found: false,
        instruction: `Could not retrieve product details due to: ${msg}. Apologize and offer to check another club.`
      };
    }
  },

  /**
   * 4. MUTATING TOOL: send_product_media (Sends WhatsApp Kit Card with idempotency)
   */
  async send_product_media(
    organizationId: string,
    conversationId: string,
    customerPhone: string,
    args: { jerseyId?: string; team?: string; kitType?: string; idempotencyKey?: string }
  ): Promise<SendProductMediaResult> {
    // Check idempotency cache
    const cached = getCachedResult<SendProductMediaResult>(args.idempotencyKey);
    if (cached) return cached;

    try {
      let jersey: JerseyRecord | null = null;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      if (args.jerseyId && uuidRegex.test(args.jerseyId)) {
        jersey = await catalogService.getJersey(organizationId, args.jerseyId);
      } else if (args.team) {
        const found = await catalogService.getCatalog(organizationId, {
          team: args.team,
          kitType: args.kitType || 'Home',
          limit: 1
        });
        jersey = found.data[0] || null;
      }

      if (!jersey || !jersey.imageUrl) {
        return {
          success: false,
          error: 'Jersey not found or has no photo available.',
          instruction: 'Explain to the customer that no photo is currently available for this kit.'
        };
      }

      const setting = await prisma.setting.findUnique({
        where: { organizationId },
        select: { currency: true }
      });
      const currency = setting?.currency || 'NGN';

      const metaMessageId = await whatsappService.sendKitCard(organizationId, {
        toPhone: customerPhone,
        jerseyTitle: jersey.title,
        imageUrl: jersey.imageUrl,
        price: jersey.basePrice,
        currency,
        description: jersey.description
      });

      const savedKitMessage = await chatRepository.insertMessage(organizationId, {
        conversationId,
        metaMessageId,
        direction: 'outbound',
        type: 'interactive_kit',
        body: `⚽ ${jersey.title} - ${currency} ${jersey.basePrice}`,
        mediaUrl: jersey.imageUrl,
        jerseyId: jersey.id,
        deliveryStatus: 'sent'
      });

      if (savedKitMessage) {
        socketService.emitNewMessage(organizationId, savedKitMessage);
        const updatedConv = await chatRepository.getConversationById(organizationId, conversationId);
        if (updatedConv) {
          socketService.emitConversationUpdated(organizationId, updatedConv);
        }
      }

      const response: SendProductMediaResult = {
        success: true,
        jerseyTitle: jersey.title,
        imageUrl: jersey.imageUrl,
        instruction: 'The photo card has been delivered directly to the customer as a real WhatsApp photo card! Do NOT output links or markdown tags. Confirm you sent the photo above and ask what size they need.'
      };

      setCachedResult(args.idempotencyKey, response);
      return response;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send photo';
      return {
        success: false,
        error: msg,
        instruction: 'Could not deliver photo card due to a temporary network issue. Apologize and offer to check sizes or pricing.'
      };
    }
  },

  /**
   * 5. MUTATING TOOL: create_checkout (Creates order, 15-min hold, Paystack link with idempotency)
   */
  async create_checkout(
    organizationId: string,
    conversationId: string,
    customerPhone: string,
    args: {
      jerseyId?: string;
      team?: string;
      kitType?: string;
      size: JerseySize;
      quantity?: number;
      customName?: string;
      customNumber?: string;
      shippingAddress?: string;
      idempotencyKey?: string;
    }
  ): Promise<CreateCheckoutResult> {
    // Check idempotency cache
    const cached = getCachedResult<CreateCheckoutResult>(args.idempotencyKey);
    if (cached) return cached;

    const validSizes: JerseySize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let targetJerseyId = args.jerseyId;
    if (!targetJerseyId || !uuidRegex.test(targetJerseyId)) {
      if (args.team) {
        const found = await catalogService.getCatalog(organizationId, {
          team: args.team,
          kitType: args.kitType || 'Home',
          limit: 1
        });
        if (found.data[0]) {
          targetJerseyId = found.data[0].id;
        }
      }
    }

    if (!targetJerseyId || !uuidRegex.test(targetJerseyId)) {
      return {
        success: false,
        error: 'Invalid or missing jerseyId. Could not identify the requested jersey for checkout.'
      };
    }

    if (!args.size || !validSizes.includes(args.size)) {
      return {
        success: false,
        error: `Invalid size "${args.size}". Valid jersey sizes are: ${validSizes.join(', ')}.`
      };
    }

    const rawQty = Number(args.quantity);
    const quantity = !isNaN(rawQty) && rawQty >= 1 && rawQty <= 10 ? Math.floor(rawQty) : 1;

    let order;
    try {
      order = await ordersService.createOrder(organizationId, {
        customerPhone,
        shippingAddress: args.shippingAddress,
        items: [
          {
            jerseyId: targetJerseyId,
            size: args.size,
            quantity,
            customName: args.customName?.trim() || undefined,
            customNumber: args.customNumber?.trim() || undefined
          }
        ]
      });
    } catch (orderError: unknown) {
      const msg = orderError instanceof Error ? orderError.message : 'Failed to create order.';
      return {
        success: false,
        error: msg
      };
    }

    let paymentInit: { authorizationUrl: string; accessCode: string; reference: string };
    try {
      paymentInit = await paymentsService.initializePayment(
        organizationId,
        order.id,
        `${customerPhone.replace(/\+/g, '')}@whatsapp.customer`
      );
    } catch (paystackError: unknown) {
      const msg = paystackError instanceof Error ? paystackError.message : 'Payment error';
      console.error(
        `[create_checkout] Paystack initialization failed for order ${order.id}. Releasing reserved stock:`,
        msg
      );
      await ordersService.cancelOrderAndReleaseStock(organizationId, order.id);
      return {
        success: false,
        error: `Payment initialization temporarily unavailable: ${msg}`
      };
    }

    try {
      const jersey = await catalogService.getJersey(organizationId, targetJerseyId!);

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

      const metaMessageId = await whatsappService.sendTextMessage(organizationId, {
        toPhone: customerPhone,
        body: checkoutCard
      });

      const savedCheckoutMessage = await chatRepository.insertMessage(organizationId, {
        conversationId,
        metaMessageId,
        direction: 'outbound',
        type: 'payment_link',
        body: checkoutCard,
        deliveryStatus: 'sent'
      });

      if (savedCheckoutMessage) {
        socketService.emitNewMessage(organizationId, savedCheckoutMessage);
        const updatedConv = await chatRepository.getConversationById(organizationId, conversationId);
        if (updatedConv) {
          socketService.emitConversationUpdated(organizationId, updatedConv);
        }
      }

      const response: CreateCheckoutResult = {
        success: true,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        currency: order.currency,
        checkoutUrl: paymentInit.authorizationUrl,
        checkoutCardSentAbove: true,
        instruction: 'The order confirmation and Paystack payment link have been delivered directly to the customer above! Remind them their kit is reserved for 15 minutes.'
      };

      setCachedResult(args.idempotencyKey, response);
      return response;
    } catch (postOrderError: unknown) {
      const msg = postOrderError instanceof Error ? postOrderError.message : 'Notification error';
      console.warn(`[create_checkout] Non-fatal notification error:`, msg);
      const response: CreateCheckoutResult = {
        success: true,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        currency: order.currency,
        checkoutUrl: paymentInit.authorizationUrl,
        instruction: `Order #${order.orderNumber} created. Paystack link: ${paymentInit.authorizationUrl}`
      };
      setCachedResult(args.idempotencyKey, response);
      return response;
    }
  },

  /**
   * 6. MUTATING TOOL: update_order_shipping_address (Updates address/notes with state validation and idempotency)
   */
  async update_order_shipping_address(
    organizationId: string,
    conversationId: string,
    customerId: string,
    args: {
      shippingAddress: string;
      orderNumber?: string | number;
      deliveryNotes?: string;
      idempotencyKey?: string;
    }
  ): Promise<UpdateOrderAddressResult> {
    const cached = getCachedResult<UpdateOrderAddressResult>(args.idempotencyKey);
    if (cached) return cached;

    // Sanitize and limit delivery address to 500 characters
    const sanitizedAddress = (args.shippingAddress || '')
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

    // Sanitize and limit delivery notes to 500 characters
    const sanitizedNotes = args.deliveryNotes
      ? args.deliveryNotes.trim().replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').slice(0, 500)
      : undefined;

    const orderIdentifier =
      args.orderNumber !== undefined && args.orderNumber !== null
        ? String(args.orderNumber).slice(0, 50)
        : undefined;

    try {
      const result = await ordersService.updateOrderAddressAndNotes({
        organizationId,
        customerId,
        orderIdentifier,
        shippingAddress: sanitizedAddress,
        deliveryNotes: sanitizedNotes,
        conversationId
      });

      setCachedResult(args.idempotencyKey, result);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Database error';
      return {
        success: false,
        code: 'ORDER_NOT_FOUND',
        message: `Failed to update delivery address: ${msg}`,
        instruction: 'Inform the customer that we encountered an issue updating the address and ask them to verify their details.'
      };
    }
  }
};

