import { prisma } from '../../core/database/prisma.js';
import { Prisma } from '@prisma/client';
import { chatRepository } from '../chat/chat.repository.js';
import { whatsappService } from '../whatsapp/whatsapp.service.js';
import { socketService } from '../../core/socket/socket.service.js';
import { AiProviders, createDefaultProviders } from './providers/openai.provider.js';
import { routeMessage } from './ai.router.js';
import { runAgentTurn } from './ai.agent.js';
import { ChatMessage, CustomerContext, AiBudgetStatus } from './ai.types.js';

const SYSTEM_PROMPT = `You are the friendly, expert AI Sales Assistant for Jersey Hub, an online football jersey store.
Your goal is to help customers find authentic club and national team kits, verify size availability, and complete their purchases seamlessly.

CORE PRINCIPLES & INTENT RECOGNITION:
1. Tone & Style:
   - Friendly, concise, enthusiastic about football.
   - Format replies cleanly for mobile WhatsApp reading (use bolding and emojis like ⚽ sparingly).
2. Context & Follow-Up Intent Retention:
   - When a customer asks a follow-up (e.g. "send me the home kit", "what about the away", "let me see home kit", "do you have third?"), ALWAYS retain the active team from previous messages in the conversation.
   - When the customer asks for a specific kit type (Home, Away, Third, Goalkeeper), pass \`kitType\` explicitly (e.g. team: "Manchester United", kitType: "Home").
3. Product Photos & Media Delivery:
   - When a customer asks about a jersey, asks to see it, asks for a photo, asks "show me", "let me see it", or inquires about pricing and sizes, ALWAYS call \`show_product\`.
   - \`show_product\` automatically resolves the jersey, verifies in-stock sizes, and delivers the official high-resolution photo card directly into the customer WhatsApp thread in a single step!
   - Set \`sendPhoto: true\` (the default) whenever the customer asks to see, view, or get photos. Set \`sendPhoto: false\` only if they strictly asked for a text-only question.
   - CRITICAL: When \`show_product\` reports \`photoSent: true\`, let the customer know the official photo has been sent above 📸, state the price and in-stock sizes, and ask what size they would like to order.
   - NEVER output markdown links, image tags like ![alt](url), or fake links like [View Kit](...).
4. Truthful & Real Data Only (Zero Fabrication):
   - NEVER fabricate prices, stock, order numbers, or payment links.
   - Only state an item is "out of stock" if verified that \`availableSizes\` has 0 quantity.
   - If a kit type does not exist in the catalog, truthfully explain that we do not carry that version and offer the kits that are in stock.
5. Closing Sales & Order Checkout:
   - When a customer is ready to buy and has picked their size, use \`create_checkout\` to generate a secure Paystack payment link and hold their jersey for 15 minutes.
   - Inform the customer that their kit is reserved for 15 minutes while they complete checkout.
6. Order & Payment Inquiries:
   - When a customer asks about their order status, payment confirmation, or shipping tracking, use \`check_order_status\` to look up their order.
7. Updating Delivery Address & Delivery Instructions:
   - When a customer wants to change, correct, or update their delivery address or add delivery instructions (e.g. gate code, phone note), call \`update_order_shipping_address\`.
   - Pass the full address in \`shippingAddress\`, and any specific delivery instructions in \`deliveryNotes\`. If they mention an order number (e.g. #10042), pass it in \`orderNumber\`.
   - STRICT STATE MACHINE GUARDRAILS: If the tool reports that the order has already shipped or been handed to the courier, TRUTHFULLY explain this boundary and direct the customer to human support. Do NOT promise an address change that the system has rejected.`;

export class AiService {
  private providers: AiProviders;

  constructor(providers?: AiProviders) {
    this.providers = providers || createDefaultProviders();
  }

  /**
   * Main entry point when an inbound customer WhatsApp message arrives.
   */
  async handleInboundCustomerMessage(
    organizationId: string,
    conversationId: string,
    customer: CustomerContext,
    userMessage: string
  ): Promise<void> {
    try {
      // 1. Check if AI is enabled for this conversation (Human Takeover check)
      const conversation = await chatRepository.getConversationById(organizationId, conversationId);
      if (!conversation || !conversation.isAiEnabled) {
        return; // Human agent has taken over
      }

      // 2. Pre-flight Budget & Global AI Switch Check (Prevents OpenAI API costs if locked/capped)
      const budgetStatus = await this.getBudgetStatus(organizationId);
      if (
        !budgetStatus.isGloballyEnabled ||
        budgetStatus.isLocked ||
        budgetStatus.currentSpendUsd >= budgetStatus.maxBudgetUsd
      ) {
        console.warn(
          `[AI Safety] Organization ${organizationId} AI budget capped or globally disabled ($${budgetStatus.currentSpendUsd}/$${budgetStatus.maxBudgetUsd}). Skipping LLM call.`
        );
        return;
      }

      // 3. Layer 1 & 2 Deterministic Routing (Zero LLM overhead)
      const route = routeMessage({ userMessage });

      // Out of scope: static redirect with $0 OpenAI cost
      if (route.type === 'out_of_scope') {
        const metaMessageId = await whatsappService.sendTextMessage(organizationId, {
          toPhone: customer.phoneNumber,
          body: route.redirectMessage
        });

        const savedRedirect = await chatRepository.insertMessage(organizationId, {
          conversationId,
          metaMessageId,
          direction: 'outbound',
          type: 'text',
          body: route.redirectMessage,
          deliveryStatus: 'sent'
        });

        if (savedRedirect) {
          socketService.emitNewMessage(organizationId, savedRedirect);
          const updatedConv = await chatRepository.getConversationById(organizationId, conversationId);
          if (updatedConv) {
            socketService.emitConversationUpdated(organizationId, updatedConv);
          }
        }
        return;
      }

      // 4. Fetch recent message history (last 12 messages for rich context)
      const recentMessages = await chatRepository.getMessages(organizationId, conversationId, 12);

      const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

      for (const m of recentMessages) {
        if (m.type === 'text' && m.body) {
          messages.push({
            role: m.direction === 'inbound' ? 'user' : 'assistant',
            content: m.body
          });
        } else if (m.type === 'interactive_kit') {
          const kitName = m.jerseyTitle || m.body || 'Jersey Kit Card';
          messages.push({
            role: 'assistant',
            content: `[Photo Card sent to customer: ${kitName}]`
          });
        } else if (m.type === 'payment_link') {
          messages.push({
            role: 'assistant',
            content: '[Order Invoice & Payment Link sent to customer]'
          });
        }
      }

      // Ensure the latest user message is present
      if (messages[messages.length - 1]?.content !== userMessage) {
        messages.push({ role: 'user', content: userMessage });
      }

      // 5. Run Multi-Tier Agent Turn (fast -> smart escalation, pre-tool validation, max 4 tools)
      const agentResult = await runAgentTurn(this.providers, route.tier, messages, {
        organizationId,
        conversationId,
        customer
      });

      if (!agentResult.text) return;

      // 6. Clean and sanitize reply text: strip any hallucinated markdown links or bracket syntax
      const cleanReplyText = (agentResult.text || '')
        .replace(/!\[([^\]]*)\]\([^\)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^\)]*\)/g, '$1')
        .replace(/(?:^|\n)\s*[-*•]?\s*(?:View|See)\s+.*?Kit\s*(?:\n|$)/gi, '\n')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();

      if (!cleanReplyText) return;

      // 7. Atomic Concurrency-Safe Budget Enforcement (Fail-closed)
      const modelDisplayName =
        agentResult.models.length > 0
          ? agentResult.models.join(', ')
          : this.providers[route.tier].getModelName();

      const isAllowed = await this.checkAndRecordAiUsage(
        organizationId,
        conversationId,
        modelDisplayName,
        agentResult.promptTokens,
        agentResult.completionTokens,
        agentResult.costUsd,
        agentResult.toolsCalled
      );

      if (!isAllowed) {
        console.warn(
          `[AI Safety] Organization ${organizationId} AI budget limit reached or globally disabled. Suppressing outbound AI reply.`
        );
        return;
      }

      // 8. Dispatch outbound text response to customer WhatsApp
      const metaMessageId = await whatsappService.sendTextMessage(organizationId, {
        toPhone: customer.phoneNumber,
        body: cleanReplyText
      });

      // 9. Persist AI outbound message to CRM database
      const savedAiMessage = await chatRepository.insertMessage(organizationId, {
        conversationId,
        metaMessageId,
        direction: 'outbound',
        type: 'text',
        body: cleanReplyText,
        deliveryStatus: 'sent'
      });

      if (savedAiMessage) {
        socketService.emitNewMessage(organizationId, savedAiMessage);
        const updatedConv = await chatRepository.getConversationById(organizationId, conversationId);
        if (updatedConv) {
          socketService.emitConversationUpdated(organizationId, updatedConv);
        }
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[AI Error] Failed processing message for conversation ${conversationId}:`, errMsg);
    }
  }

  /**
   * Concurrency-safe atomic token usage tracking and hard budget enforcement.
   * Uses PostgreSQL pessimistic row-level locking (SELECT ... FOR UPDATE) to eliminate budget race conditions.
   * Fails closed: returns false if budget is exceeded or globally disabled.
   */
  async checkAndRecordAiUsage(
    organizationId: string,
    conversationId: string,
    modelName: string,
    promptTokens: number,
    completionTokens: number,
    costUsd: number,
    toolsCalled: string[]
  ): Promise<boolean> {
    const lagosDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
    const monthDate = new Date(`${lagosDateStr.slice(0, 7)}-01T00:00:00.000Z`);

    try {
      return await prisma.$transaction(async (tx) => {
        // 1. Fetch organization settings for global switch and default budget
        const settings = await tx.setting.findUnique({
          where: { organizationId },
          select: { aiEnabledGlobally: true, maxMonthlyAiBudgetUsd: true }
        });

        if (settings && !settings.aiEnabledGlobally) {
          return false;
        }

        const defaultMaxBudget = Number(settings?.maxMonthlyAiBudgetUsd ?? 15.0);

        // 2. Ensure monthly budget row exists for this organization and month
        await tx.aiMonthlyBudget.upsert({
          where: {
            organizationId_monthDate: {
              organizationId,
              monthDate
            }
          },
          create: {
            organizationId,
            monthDate,
            maxBudgetUsd: defaultMaxBudget,
            currentSpendUsd: 0.0,
            isLocked: false
          },
          update: {} // do not mutate existing spend
        });

        // 3. Pessimistic row locking on monthly budget
        const lockedBudgets = await tx.$queryRaw<Array<{
          organization_id: string;
          month_date: Date;
          max_budget_usd: Prisma.Decimal;
          current_spend_usd: Prisma.Decimal;
          is_locked: boolean;
        }>>`
          SELECT organization_id, month_date, max_budget_usd, current_spend_usd, is_locked
          FROM ai_monthly_budgets
          WHERE organization_id = ${organizationId}
            AND month_date = ${monthDate}::date
          FOR UPDATE;
        `;

        if (!lockedBudgets || lockedBudgets.length === 0) {
          return false;
        }

        const budget = lockedBudgets[0];
        const currentSpend = Number(budget.current_spend_usd);
        const maxBudget = Number(budget.max_budget_usd);

        if (budget.is_locked || currentSpend >= maxBudget) {
          return false; // Hard budget cap reached
        }

        const newSpend = currentSpend + costUsd;
        const shouldLock = newSpend >= maxBudget;

        // 4. Atomically update monthly budget spend
        await tx.aiMonthlyBudget.update({
          where: {
            organizationId_monthDate: {
              organizationId,
              monthDate
            }
          },
          data: {
            currentSpendUsd: newSpend,
            isLocked: shouldLock
          }
        });

        // 5. Append immutable audit row to ai_usage_logs
        await tx.aiUsageLog.create({
          data: {
            organizationId,
            conversationId,
            model: modelName,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            estimatedCostUsd: costUsd,
            toolsCalled
          }
        });

        return true;
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[AI Budget Error] Transaction failed for org ${organizationId} (failing closed):`, errMsg);
      return false; // Fail closed
    }
  }

  /**
   * Retrieves current AI budget and spending metrics for an organization.
   * Uses Africa/Lagos timezone to compute monthly boundaries accurately.
   */
  async getBudgetStatus(organizationId: string): Promise<AiBudgetStatus> {
    const lagosDateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
    const monthDate = new Date(`${lagosDateStr.slice(0, 7)}-01T00:00:00.000Z`);
    const firstDayOfMonth = `${lagosDateStr.slice(0, 7)}-01`;

    const [budget, settings, tokenAgg] = await Promise.all([
      prisma.aiMonthlyBudget.findUnique({
        where: {
          organizationId_monthDate: {
            organizationId,
            monthDate
          }
        }
      }),
      prisma.setting.findUnique({
        where: { organizationId },
        select: { maxMonthlyAiBudgetUsd: true, aiEnabledGlobally: true }
      }),
      prisma.aiUsageLog.aggregate({
        where: {
          organizationId,
          createdAt: { gte: monthDate }
        },
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true
        }
      })
    ]);

    return {
      organizationId,
      monthDate: firstDayOfMonth,
      maxBudgetUsd: Number(budget?.maxBudgetUsd ?? settings?.maxMonthlyAiBudgetUsd ?? 15.0),
      currentSpendUsd: Number(budget?.currentSpendUsd ?? 0.0),
      isLocked: Boolean(budget?.isLocked),
      isGloballyEnabled: Boolean(settings?.aiEnabledGlobally ?? true),
      tokens: {
        total: tokenAgg._sum.totalTokens ?? 0,
        prompt: tokenAgg._sum.promptTokens ?? 0,
        completion: tokenAgg._sum.completionTokens ?? 0
      }
    };
  }
}

export const aiService = new AiService();
