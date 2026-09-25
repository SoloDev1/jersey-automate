import { whatsappActions, WhatsAppAction } from '../whatsapp/whatsapp-actions.js';
import { whatsappCommerceService } from '../whatsapp/whatsapp-commerce.service.js';
import { catalogService } from '../catalog/catalog.service.js';
import { ordersService } from '../orders/orders.service.js';
import { paymentsService } from '../payments/payments.service.js';
import { chatService } from '../chat/chat.service.js';
import { socketService } from '../../core/socket/socket.service.js';

export interface ActionRouterContext {
  organizationId: string;
  conversationId: string;
  customer: {
    id: string;
    phoneNumber: string;
    displayName: string | null;
  };
}

export const interactiveActionRouter = {
  /**
   * Determines if a given action ID is recognized and handled deterministically.
   */
  isHandled(rawActionId: string | undefined): boolean {
    if (!rawActionId) return false;
    return whatsappActions.parse(rawActionId) !== null;
  },

  /**
   * Dispatches a parsed action to the appropriate domain service without calling AI inference.
   */
  async dispatch(rawActionId: string, ctx: ActionRouterContext): Promise<boolean> {
    const action: WhatsAppAction | null = whatsappActions.parse(rawActionId);
    if (!action) return false;

    const { organizationId, conversationId, customer } = ctx;
    const toPhone = customer.phoneNumber;

    try {
      switch (action.type) {
        case 'view': {
          const jersey = await catalogService.getJersey(organizationId, action.jerseyId);
          if (jersey && jersey.isActive) {
            await whatsappCommerceService.sendJerseyCard(organizationId, conversationId, {
              toPhone,
              jersey
            });
            return true;
          }
          break;
        }

        case 'sizes': {
          const jersey = await catalogService.getJersey(organizationId, action.jerseyId);
          if (jersey && jersey.isActive) {
            await whatsappCommerceService.sendSizePicker(organizationId, conversationId, {
              toPhone,
              jersey
            });
            return true;
          }
          break;
        }

        case 'team': {
          const res = await catalogService.getCatalog(organizationId, {
            team: action.team,
            limit: 10
          });
          if (res.data.length > 0) {
            await whatsappCommerceService.sendKitList(organizationId, conversationId, {
              toPhone,
              team: action.team,
              jerseys: res.data
            });
            return true;
          }
          break;
        }

        case 'buy': {
          // 1. Never trust the button payload blindly: verify jersey and real-time inventory
          const jersey = await catalogService.getJersey(organizationId, action.jerseyId);
          if (!jersey || !jersey.isActive) {
            return false;
          }

          const stockCheck = await catalogService.isSizeAvailable(
            organizationId,
            action.jerseyId,
            action.size,
            1
          );

          if (!stockCheck.available) {
            // Inventory race condition: item just sold out -> send size picker with remaining sizes
            await whatsappCommerceService.sendSizePicker(organizationId, conversationId, {
              toPhone,
              jersey
            });
            return true;
          }

          // 2. Atomic reservation & order hold (15-minute hold)
          const order = await ordersService.createOrder(organizationId, {
            customerPhone: toPhone,
            items: [
              {
                jerseyId: action.jerseyId,
                size: action.size,
                quantity: 1
              }
            ]
          });

          // 3. Initialize secure Paystack transaction
          const customerEmail = `${toPhone.replace(/\+/g, '')}@whatsapp.customer`;
          const paymentInit = await paymentsService.initializePayment(
            organizationId,
            order.id,
            customerEmail
          );

          // 4. Deliver interactive Paystack CTA card
          await whatsappCommerceService.sendCheckoutCard(organizationId, conversationId, {
            toPhone,
            orderNumber: order.orderNumber,
            jerseyTitle: jersey.title,
            size: action.size,
            totalAmount: order.totalAmount,
            currency: order.currency,
            paymentUrl: paymentInit.authorizationUrl
          });

          return true;
        }

        case 'support_human': {
          // Disable AI for this thread to enable human takeover
          await chatService.toggleAi(organizationId, conversationId, false);

          await whatsappCommerceService.sendHumanSupportHandover(organizationId, conversationId, {
            toPhone
          });
          return true;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ActionRouter] Error executing action "${rawActionId}":`, msg);
    }

    return false;
  }
};
