import { ChatMessage, ToolDefinition, AiResponse } from '../ai.types.js';

export interface AiProvider {
  /**
   * Generates a conversational response or tool calls.
   */
  generateResponse(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<AiResponse>;

  /**
   * Computes estimated cost in USD based on model pricing.
   */
  estimateCostUsd(promptTokens: number, completionTokens: number): number;

  /**
   * Returns model identifier.
   */
  getModelName(): string;
}
