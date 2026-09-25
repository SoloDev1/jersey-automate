import { prisma } from '../../core/database/prisma.js';
import { Prisma } from '@prisma/client';
import { chatRepository } from '../chat/chat.repository.js';
import { whatsappService } from '../whatsapp/whatsapp.service.js';
import { socketService } from '../../core/socket/socket.service.js';
import { AiProviders, createDefaultProviders } from './providers/openai.provider.js';
import { routeMessage } from './ai.router.js';
import { runAgentTurn } from './ai.agent.js';
import { ChatMessage, CustomerContext, AiBudgetStatus } from './ai.types.js';

import { getToolsForRoute } from './ai.tools.js';
import { conversationStateService } from '../chat/conversation-state.service.js';

export const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours inactivity timeout

const SYSTEM_PROMPT = `You are the football jersey sales assistant for Jersey Hub on WhatsApp.
Help customers find authentic kits, check stock, and view kit cards.

RULES:
1. Tone: Friendly, concise, mobile-friendly (use bolding and ⚽ sparingly).
2. Product Inquiry: Call show_product when asked to see a kit, view photos, or check prices/sizes. Retain active team from previous context.
3. Truthful: Never invent prices, sizes, or stock. Use tool data only.
4. Formatting: Never output markdown links or image tags like ![alt](url). WhatsApp cards handle visuals.`;

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
    userMessage: string,
    inboundTimestamp?: Date
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

      // 4. Session Boundary & Explicit Tool State Hygiene
      const currentInboundTime = inboundTimestamp || new Date();
      const previousMeaningfulMessage = await chatRepository.getLastMeaningfulMessage(
        organizationId,
        conversationId
      );

      const prevTimeMs = previousMeaningfulMessage?.messageTimestamp
        ? new Date(previousMeaningfulMessage.messageTimestamp).getTime()
        : previousMeaningfulMessage?.createdAt
          ? new Date(previousMeaningfulMessage.createdAt).getTime()
          : null;

      const isNewSession =
        !prevTimeMs || currentInboundTime.getTime() - prevTimeMs > SESSION_TIMEOUT_MS;

      // When a session boundary is crossed:
      // Explicitly reset transactional commerce state (active jersey hold, size selection, pending order)
      if (isNewSession) {
        await conversationStateService.startNewSession(organizationId, conversationId);
      }

      // Fetch recent message history (last 6 messages for focused context)
      const recentMessages = await chatRepository.getMessages(organizationId, conversationId, 6);
      const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

      if (isNewSession) {
        const hoursInactive = prevTimeMs
          ? Math.round((currentInboundTime.getTime() - prevTimeMs) / 3600000)
          : null;

        messages.push({
          role: 'system',
          content: `[SESSION BOUNDARY: NEW SESSION]
Customer is returning after ${hoursInactive !== null ? `${hoursInactive}+ hours` : 'a period'} of inactivity.
- Any prior pending orders, checkouts, or promises to check kit availability are EXPIRED and CANCELLED.
- DO NOT resume or push past checkout links or availability checks unless the customer explicitly asks about them.
- If the customer sends a greeting (e.g. "Hi", "Hello"), welcome them back warmly and ask how you can help them today.
- If the customer asks a specific question (e.g. "Do you have Arsenal kit?"), assist them directly with fresh information.`
        });

        // Provide previous interest strictly as passive background knowledge
        if (previousMeaningfulMessage && previousMeaningfulMessage.body) {
          messages.push({
            role: 'system',
            content: `[Customer Background Knowledge: In their previous session, customer discussed: "${previousMeaningfulMessage.body.slice(0, 120)}"]`
          });
        }
      } else {
        // Continuous active session: include recent turns
        for (const m of recentMessages) {
          if (m.type === 'text' && m.body) {
            messages.push({
              role: m.direction === 'inbound' ? 'user' : 'assistant',
              content: m.body
            });
          }
        }
      }

      // Ensure the latest user message is present
      if (messages[messages.length - 1]?.content !== userMessage) {
        messages.push({ role: 'user', content: userMessage });
      }

      // 5. Run Multi-Tier Agent Turn with Dynamic Tool Gating
      const activeTools = getToolsForRoute(route.allowedTools);
      const agentResult = await runAgentTurn(
        this.providers,
        route.tier,
        messages,
        {
          organizationId,
          conversationId,
          customer
        },
        activeTools
      );

      // 6. Atomic Concurrency-Safe Budget Enforcement & Telemetry
      const modelDisplayName =
        agentResult.models.length > 0
          ? agentResult.models.join(', ')
          : this.providers[route.tier].getModelName();

      if (agentResult.promptTokens > 0) {
        const isAllowed = await this.checkAndRecordAiUsage(
          organizationId,
          conversationId,
          modelDisplayName,
          agentResult.promptTokens,
          agentResult.completionTokens,
          agentResult.costUsd,
          agentResult.toolsCalled,
          route.requestType
        );

        if (!isAllowed) {
          console.warn(
            `[AI Safety] Organization ${organizationId} AI budget limit reached or globally disabled.`
          );
          return;
        }
      }

      // If a tool already delivered the complete UI card to WhatsApp, single-pass terminates here
      if (!agentResult.text) return;

      // 7. Clean and sanitize reply text: strip any hallucinated markdown links or bracket syntax
      const cleanReplyText = (agentResult.text || '')
        .replace(/!\[([^\]]*)\]\([^\)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^\)]*\)/g, '$1')
        .replace(/(?:^|\n)\s*[-*•]?\s*(?:View|See)\s+.*?Kit\s*(?:\n|$)/gi, '\n')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();

      if (!cleanReplyText) return;

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
    toolsCalled: string[],
    requestType?: string
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
            requestType: requestType || 'natural_language',
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
