import { supabase } from '../../core/database/supabase.js';
import { chatRepository } from '../chat/chat.repository.js';
import { whatsappService } from '../whatsapp/whatsapp.service.js';
import { AiProvider } from './providers/aiProvider.interface.js';
import { OpenAiProvider } from './providers/openai.provider.js';
import { AI_TOOLS, toolHandlers } from './ai.tools.js';
import { ChatMessage, CustomerContext } from './ai.types.js';

const SYSTEM_PROMPT = `You are the friendly, expert AI Sales Assistant for Jersey Hub, an online football jersey store.
Your goal is to help customers find authentic club and national team kits, verify size availability, and complete their purchases seamlessly.

CORE PRINCIPLES & INTENT RECOGNITION:
1. Tone: Friendly, concise, enthusiastic about football. Format replies cleanly for mobile WhatsApp reading (use bolding and emojis like ⚽ sparingly).
2. Context & Follow-Up Intent Retention:
   - When a customer asks a follow-up (e.g. "send me the home kit", "what about the away", "let me see home kit", "do you have third?"), ALWAYS retain the active team from previous messages in the conversation.
   - When the customer asks for a specific kit type (Home, Away, Third, Goalkeeper), pass \`kitType\` explicitly to \`search_catalog\` (e.g. team: "Manchester United", kitType: "Home").
3. Automated WhatsApp Photos:
   - When \`search_catalog\` runs, high-resolution photo cards are AUTOMATICALLY delivered directly to the customer's WhatsApp phone.
   - If the customer asked for a specific kit (e.g. "home kit"), only that specific kit photo is delivered.
   - CRITICAL: NEVER output markdown links, image tags like ![alt](url), or fake links like [View Kit](...). Simply tell the customer that you have sent the photo above 📸.
4. Truthful & Real Data Only (Zero Fabrication):
   - NEVER fabricate prices, stock, or reasons.
   - Only state an item is "out of stock" if verified via \`check_stock\` that \`availableSizes\` has 0 quantity.
   - If a kit type does not exist in the catalog, truthfully explain that we do not carry that version and offer the kits that are in stock.
5. Closing Sales:
   - When a customer is ready to buy and has picked their size, use \`create_checkout\` to generate a secure Paystack payment link and hold their jersey for 15 minutes.
   - Inform the customer that their kit is reserved for 15 minutes while they complete checkout.`;

export class AiService {
  private provider: AiProvider;

  constructor(provider?: AiProvider) {
    this.provider = provider || new OpenAiProvider();
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
      // 1. Check if AI is enabled for this conversation
      const conversation = await chatRepository.getConversationById(organizationId, conversationId);
      if (!conversation || !conversation.isAiEnabled) {
        return; // Human Takeover active
      }

      // 2. Pre-flight Budget & Global AI Switch Check (Prevents OpenAI API costs if locked/capped)
      const budgetStatus = await this.getBudgetStatus(organizationId);
      if (!budgetStatus.isGloballyEnabled || budgetStatus.isLocked || budgetStatus.currentSpendUsd >= budgetStatus.maxBudgetUsd) {
        console.warn(
          `[AI Safety] Organization ${organizationId} AI budget capped or globally disabled ($${budgetStatus.currentSpendUsd}/$${budgetStatus.maxBudgetUsd}). Skipping LLM call.`
        );
        return;
      }

      // 3. Fetch recent message history (last 12 messages for rich context)
      const recentMessages = await chatRepository.getMessages(organizationId, conversationId, 12);
      
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT }
      ];

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
            content: `[Order Invoice & Payment Link sent to customer]`
          });
        }
      }

      // Ensure the latest user message is present
      if (messages[messages.length - 1]?.content !== userMessage) {
        messages.push({ role: 'user', content: userMessage });
      }

      // 3. First LLM Turn (Model decides whether to invoke tools)
      let aiResponse = await this.provider.generateResponse(messages, AI_TOOLS);
      const toolsCalledNames: string[] = [];

      // 4. Handle Tool Calls if requested by LLM
      if (aiResponse.toolCalls && aiResponse.toolCalls.length > 0) {
        // Append assistant's tool-call message
        messages.push({
          role: 'assistant',
          content: aiResponse.text,
          toolCalls: aiResponse.toolCalls
        });

        for (const toolCall of aiResponse.toolCalls) {
          const fnName = toolCall.function.name;
          toolsCalledNames.push(fnName);
          let parsedArgs: any = {};
          try {
            parsedArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            parsedArgs = {};
          }

          let toolOutput: any;
          if (fnName === 'search_catalog') {
            toolOutput = await toolHandlers.search_catalog(
              organizationId,
              conversationId,
              customer.phoneNumber,
              parsedArgs
            );
          } else if (fnName === 'check_stock') {
            toolOutput = await toolHandlers.check_stock(organizationId, parsedArgs);
          } else if (fnName === 'create_checkout') {
            toolOutput = await toolHandlers.create_checkout(
              organizationId,
              conversationId,
              customer.phoneNumber,
              parsedArgs
            );
          } else {
            toolOutput = { error: `Unknown tool: ${fnName}` };
          }

          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            name: fnName,
            content: JSON.stringify(toolOutput)
          });
        }

        // Second LLM Turn (Model synthesizes tool results into a customer reply)
        const finalResponse = await this.provider.generateResponse(messages);
        aiResponse = {
          text: finalResponse.text,
          usage: {
            promptTokens: aiResponse.usage.promptTokens + finalResponse.usage.promptTokens,
            completionTokens: aiResponse.usage.completionTokens + finalResponse.usage.completionTokens,
            totalTokens: aiResponse.usage.totalTokens + finalResponse.usage.totalTokens
          }
        };
      }

      // 5. Intercept and extract any markdown image tags ![alt](url) to dispatch as real WhatsApp photos
      const markdownImgRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s\)]+)\)/g;
      const extractedImages: Array<{ caption: string; url: string }> = [];
      let match: RegExpExecArray | null;
      while ((match = markdownImgRegex.exec(aiResponse.text || '')) !== null) {
        extractedImages.push({ caption: match[1], url: match[2] });
      }

      // Strip markdown image syntax and any hallucinated fake markdown links like [View Kit](...)
      const cleanReplyText = (aiResponse.text || '')
        .replace(markdownImgRegex, '')
        .replace(/\[([^\]]*)\]\([^\)]*\)/g, '$1')
        .replace(/(?:^|\n)\s*[-*•]?\s*(?:View|See)\s+.*?Kit\s*(?:\n|$)/gi, '\n')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();

      // If markdown image tags were detected in the text, dispatch them as real WhatsApp image cards
      for (const img of extractedImages) {
        try {
          const photoMetaId = await whatsappService.sendKitCard(organizationId, {
            toPhone: customer.phoneNumber,
            jerseyTitle: img.caption || 'Jersey Kit',
            imageUrl: img.url,
            price: 0,
            currency: 'NGN'
          });

          await chatRepository.insertMessage(organizationId, {
            conversationId,
            metaMessageId: photoMetaId,
            direction: 'outbound',
            type: 'interactive_kit',
            body: img.caption || 'Official Kit Photo',
            mediaUrl: img.url,
            deliveryStatus: 'sent'
          });
        } catch (imgErr: any) {
          console.warn('[AI Media Interceptor] Failed to dispatch extracted image:', imgErr?.message);
        }
      }

      if (!cleanReplyText) return;

      // 6. Atomic Concurrency-Safe Budget Enforcement
      const costUsd = this.provider.estimateCostUsd(
        aiResponse.usage.promptTokens,
        aiResponse.usage.completionTokens
      );

      const { data: isAllowed, error: budgetError } = await supabase.rpc(
        'check_and_record_ai_usage',
        {
          p_organization_id: organizationId,
          p_conversation_id: conversationId,
          p_model: this.provider.getModelName(),
          p_prompt_tokens: aiResponse.usage.promptTokens,
          p_completion_tokens: aiResponse.usage.completionTokens,
          p_estimated_cost_usd: costUsd,
          p_tools_called: toolsCalledNames
        }
      );

      if (budgetError) {
        console.error('[AI Budget Error] RPC check_and_record_ai_usage failed:', budgetError.message);
      }

      if (isAllowed === false) {
        console.warn(
          `[AI Safety] Organization ${organizationId} has reached its monthly AI budget limit. Pausing AI reply.`
        );
        return;
      }

      // 7. Dispatch outbound text response to customer WhatsApp
      const metaMessageId = await whatsappService.sendTextMessage(organizationId, {
        toPhone: customer.phoneNumber,
        body: cleanReplyText
      });

      // 8. Persist AI outbound message to CRM database
      await chatRepository.insertMessage(organizationId, {
        conversationId,
        metaMessageId,
        direction: 'outbound',
        type: 'text',
        body: cleanReplyText,
        deliveryStatus: 'sent'
      });
    } catch (error: any) {
      console.error(`[AI Error] Failed processing message for conversation ${conversationId}:`, error);
    }
  }

  /**
   * Retrieves current AI budget and spending metrics for an organization.
   */
  async getBudgetStatus(organizationId: string): Promise<any> {
    const monthDate = new Date();
    const firstDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
      .toISOString()
      .split('T')[0];

    const { data: budget } = await supabase
      .from('ai_monthly_budgets')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('month_date', firstDayOfMonth)
      .maybeSingle();

    const { data: settings } = await supabase
      .from('settings')
      .select('max_monthly_ai_budget_usd, ai_enabled_globally')
      .eq('organization_id', organizationId)
      .maybeSingle();

    return {
      organizationId,
      monthDate: firstDayOfMonth,
      maxBudgetUsd: Number(budget?.max_budget_usd ?? settings?.max_monthly_ai_budget_usd ?? 15.0),
      currentSpendUsd: Number(budget?.current_spend_usd ?? 0.0),
      isLocked: Boolean(budget?.is_locked),
      isGloballyEnabled: Boolean(settings?.ai_enabled_globally ?? true)
    };
  }
}

export const aiService = new AiService();
