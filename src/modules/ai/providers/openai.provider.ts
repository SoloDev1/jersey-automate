import OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool
} from 'openai/resources/chat/completions';

import { env } from '../../../core/config/env.js';
import { AiProvider } from './aiProvider.interface.js';
import {
  AiResponse,
  ChatMessage,
  ToolCall,
  ToolDefinition
} from '../ai.types.js';

export type ModelTier = 'fast' | 'smart';

export interface ModelProfile {
  model: string;

  /**
   * Determines which generation parameters are supported.
   *
   * chat:
   *   Supports temperature.
   *
   * reasoning:
   *   Uses reasoning_effort instead of temperature.
   */
  family: 'reasoning' | 'chat';

  /**
   * Pricing in USD per 1 million tokens.
   *
   * These values are estimates used for internal cost tracking,
   * not for billing customers. Set to 0 until verified with live vendor rate cards.
   */
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;

  /**
   * Maximum number of completion tokens requested from the model.
   */
  maxOutputTokens: number;

  /**
   * Reasoning budget for supported reasoning models.
   */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';

  /**
   * Sampling temperature for supported chat models.
   */
  temperature?: number;
}

/**
 * Model configuration for each AI tier.
 *
 * Model names come from environment configuration so they can be
 * changed without modifying application code.
 *
 * Pricing must be kept in sync with the provider's published pricing.
 */
export const MODEL_PROFILES: Record<ModelTier, ModelProfile> = {
  fast: {
    model: env.OPENAI_MODEL_FAST,
    family: 'chat',
    inputUsdPerMTok: 0,
    outputUsdPerMTok: 0,
    maxOutputTokens: 1500,
    temperature: 0.3
  },

  smart: {
    model: env.OPENAI_MODEL_SMART,
    family: 'chat',
    inputUsdPerMTok: 0,
    outputUsdPerMTok: 0,
    maxOutputTokens: 1200,
    temperature: 0.4
  }
};

export type AiProviders = Record<ModelTier, AiProvider>;

export class OpenAiProvider implements AiProvider {
  constructor(
    private readonly profile: ModelProfile,
    private readonly client: OpenAI
  ) {}

  getModelName(): string {
    return this.profile.model;
  }

  estimateCostUsd(
    promptTokens: number,
    completionTokens: number
  ): number {
    return (
      (promptTokens / 1_000_000) * this.profile.inputUsdPerMTok +
      (completionTokens / 1_000_000) * this.profile.outputUsdPerMTok
    );
  }

  async generateResponse(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<AiResponse> {
    const profile = this.profile;

    const params: Record<string, unknown> = {
      model: profile.model,
      messages: this.toOpenAiMessages(messages),
      max_completion_tokens: profile.maxOutputTokens
    };

    if (tools && tools.length > 0) {
      params.tools = tools as unknown as ChatCompletionTool[];
      params.tool_choice = 'auto';
    }

    if (profile.family === 'reasoning') {
      if (profile.reasoningEffort) {
        params.reasoning_effort = profile.reasoningEffort;
      }
    } else if (profile.temperature !== undefined) {
      params.temperature = profile.temperature;
    }

    const completion =
      await this.client.chat.completions.create(
        params as unknown as ChatCompletionCreateParamsNonStreaming
      );

    const message = completion.choices[0]?.message;

    const toolCalls: ToolCall[] =
      (message?.tool_calls ?? []).flatMap((call) =>
        call.type === 'function'
          ? [
              {
                id: call.id,
                type: 'function' as const,
                function: {
                  name: call.function.name,
                  arguments: call.function.arguments
                }
              }
            ]
          : []
      );

    const promptTokens =
      completion.usage?.prompt_tokens ?? 0;

    const completionTokens =
      completion.usage?.completion_tokens ?? 0;

    const totalTokens =
      completion.usage?.total_tokens ??
      promptTokens + completionTokens;

    return {
      text: message?.content ?? null,

      toolCalls:
        toolCalls.length > 0
          ? toolCalls
          : undefined,

      usage: {
        promptTokens,
        completionTokens,
        totalTokens
      }
    };
  }

  private toOpenAiMessages(
    messages: ChatMessage[]
  ): ChatCompletionMessageParam[] {
    return messages.map(
      (message): ChatCompletionMessageParam => {
        if (message.role === 'tool') {
          return {
            role: 'tool',
            tool_call_id: message.toolCallId ?? '',
            content: message.content ?? ''
          };
        }

        if (message.role === 'assistant') {
          return {
            role: 'assistant',
            content: message.content,
            ...(message.toolCalls?.length
              ? { tool_calls: message.toolCalls }
              : {})
          };
        }

        return {
          role: message.role,
          content: message.content ?? ''
        };
      }
    );
  }
}

export function createDefaultProviders(): AiProviders {
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: 30_000,
    maxRetries: 2
  });

  return {
    fast: new OpenAiProvider(
      MODEL_PROFILES.fast,
      client
    ),

    smart: new OpenAiProvider(
      MODEL_PROFILES.smart,
      client
    )
  };
}
