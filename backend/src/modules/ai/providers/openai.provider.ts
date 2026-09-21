import OpenAI from 'openai';
import { env } from '../../../core/config/env.js';
import { AiProvider } from './aiProvider.interface.js';
import { ChatMessage, ToolDefinition, AiResponse } from '../ai.types.js';

export class OpenAiProvider implements AiProvider {
  private client: OpenAI;
  private model: string;

  constructor() {
    this.model = env.OPENAI_MODEL || 'gpt-4o-mini';
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY
    });
  }

  getModelName(): string {
    return this.model;
  }

  /**
   * Estimates cost in USD for GPT-4o-mini:
   * Prompt tokens: $0.15 / 1,000,000 tokens ($0.00000015 / token)
   * Completion tokens: $0.60 / 1,000,000 tokens ($0.00000060 / token)
   */
  estimateCostUsd(promptTokens: number, completionTokens: number): number {
    const promptCost = (promptTokens / 1_000_000) * 0.15;
    const completionCost = (completionTokens / 1_000_000) * 0.60;
    return Number((promptCost + completionCost).toFixed(6));
  }

  async generateResponse(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<AiResponse> {
    if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY.includes('placeholder')) {
      console.warn('[AI] OPENAI_API_KEY is not configured or using placeholder');
      return {
        text: 'Hello! I am your football jersey assistant. Please let me know what team or club jersey you are looking for!',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      };
    }

    const openAiMessages = messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content || '',
          tool_call_id: m.toolCallId || ''
        };
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments
            }
          }))
        };
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content || ''
      };
    });

    const openAiTools = tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters
      }
    }));

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: openAiMessages,
        tools: openAiTools && openAiTools.length > 0 ? openAiTools : undefined,
        temperature: 0.3
      });

      const choice = response.choices[0];
      const message = choice?.message;

      const mappedToolCalls = message?.tool_calls?.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments
        }
      }));

      return {
        text: message?.content || null,
        toolCalls: mappedToolCalls,
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0
        }
      };
    } catch (error: any) {
      console.error('[OpenAI Error]', error.message || 'Unknown OpenAI completion failure');
      return {
        text: 'Sorry, I am having a moment. A team member will assist you shortly!',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
      };
    }
  }
}
