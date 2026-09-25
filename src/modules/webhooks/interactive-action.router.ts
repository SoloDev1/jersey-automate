import { whatsappActions, WhatsAppAction } from '../whatsapp/whatsapp-actions.js';
import { whatsappCommerceService } from '../whatsapp/whatsapp-commerce.service.js';
import { whatsappService } from '../whatsapp/whatsapp.service.js';
import { catalogService } from '../catalog/catalog.service.js';
import { chatService } from '../chat/chat.service.js';
import { conversationStateService } from '../chat/conversation-state.service.js';

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
   * GUARANTEE: Returns true for any recognized action, preventing fallback into LLM.
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
            await conversationStateService.updateState(organizationId, conversationId, {
              stage: 'viewing_product',
              jerseyId: jersey.id,
              team: jersey.team,
              kitType: jersey.kitType
            });

            await whatsappCommerceService.sendJerseyCard(organizationId, conversationId, {
              toPhone,
              jersey
            });
            return true;
          }

          await whatsappService.sendTextMessage(organizationId, {
            toPhone,
            body: `😔 Sorry, this jersey is currently unavailable. Would you like to check out another club?`
          });
          return true;
        }

        case 'sizes': {
          const jersey = await catalogService.getJersey(organizationId, action.jerseyId);
          if (jersey && jersey.isActive) {
            await conversationStateService.updateState(organizationId, conversationId, {
              stage: 'selecting_size',
              jerseyId: jersey.id,
              team: jersey.team,
              kitType: jersey.kitType
            });

            await whatsappCommerceService.sendSizePicker(organizationId, conversationId, {
              toPhone,
              jersey
            });
            return true;
          }

          await whatsappService.sendTextMessage(organizationId, {
            toPhone,
            body: `😔 Sorry, sizes are unavailable for this kit. Would you like to check out another club?`
          });
          return true;
        }

        case 'team': {
          const res = await catalogService.getCatalog(organizationId, {
            team: action.team,
            limit: 10
          });

          if (res.data.length > 0) {
            await conversationStateService.updateState(organizationId, conversationId, {
              stage: 'selecting_kit',
              team: action.team
            });

            await whatsappCommerceService.sendKitList(organizationId, conversationId, {
              toPhone,
              team: action.team,
              jerseys: res.data
            });
            return true;
          }

          await whatsappService.sendTextMessage(organizationId, {
            toPhone,
            body: `⚽ We couldn't find any available kits for *${action.team}* right now. Would you like to explore other popular clubs?`
          });
          return true;
        }

        case 'buy': {
          await whatsappCommerceService.executeCheckout(organizationId, conversationId, {
            customerPhone: toPhone,
            jerseyId: action.jerseyId,
            size: action.size,
            quantity: 1
          });
          return true;
        }

        case 'support_human': {
          // Disable AI for this thread to enable human takeover
          await chatService.toggleAi(organizationId, conversationId, false);

          await conversationStateService.updateState(organizationId, conversationId, {
            stage: 'completed'
          });

          await whatsappCommerceService.sendHumanSupportHandover(organizationId, conversationId, {
            toPhone
          });
          return true;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ActionRouter] Error executing action "${rawActionId}":`, msg);

      // Deterministic error response to customer via WhatsApp so they are never left hanging
      try {
        await whatsappService.sendTextMessage(organizationId, {
          toPhone,
          body: `⚠️ We encountered a temporary issue processing your request. Please tap the button again or contact our support team.`
        });
      } catch (sendErr: unknown) {
        console.error('[ActionRouter] Failed to send fallback error text:', sendErr);
      }
      return true; // Still marked handled! NEVER fall back into LLM!
    }

    return true;
  }
};
