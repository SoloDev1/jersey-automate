export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

export interface AiResponse {
  text: string | null;
  toolCalls?: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AiBudgetStatus {
  organizationId: string;
  monthDate: string;
  maxBudgetUsd: number;
  currentSpendUsd: number;
  isLocked: boolean;
  isGloballyEnabled: boolean;
  tokens: {
    total: number;
    prompt: number;
    completion: number;
  };
}

export interface CustomerContext {
  id: string;
  phoneNumber: string;
  displayName: string | null;
}
