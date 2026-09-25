import { AI_TOOLS, toolHandlers } from './ai.tools.js';
import type { AiProviders, ModelTier } from './providers/openai.provider.js';
import type { AiProvider } from './providers/aiProvider.interface.js';
import type { AiResponse, ChatMessage, CustomerContext, ToolCall } from './ai.types.js';

const MAX_TOOL_CALLS_PER_TURN = 4;

export interface AgentContext {
  organizationId: string;
  conversationId: string;
  customer: CustomerContext;
}

export interface AgentResult {
  text: string | null;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  toolsCalled: string[];
  models: string[];
  escalated: boolean;
}

type ToolExecutor = (
  ctx: AgentContext,
  args: Record<string, unknown>,
  toolCallId: string
) => Promise<unknown>;

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  show_product: (c, a, id) =>
    toolHandlers.show_product(
      c.organizationId,
      c.conversationId,
      c.customer.phoneNumber,
      {
        team: String(a.team || ''),
        kitType: a.kitType !== undefined ? String(a.kitType) : undefined,
        jerseyId: a.jerseyId !== undefined ? String(a.jerseyId) : undefined,
        sendPhoto: a.sendPhoto !== undefined ? Boolean(a.sendPhoto) : true,
        idempotencyKey: `${c.conversationId}:${id}`
      }
    ),
  search_catalog: (c, a) =>
    toolHandlers.search_catalog(
      c.organizationId,
      a as Parameters<typeof toolHandlers.search_catalog>[1]
    ),
  check_stock: (c, a) =>
    toolHandlers.check_stock(
      c.organizationId,
      a as Parameters<typeof toolHandlers.check_stock>[1]
    ),
  check_order_status: (c, a) =>
    toolHandlers.check_order_status(
      c.organizationId,
      c.customer.phoneNumber,
      a as Parameters<typeof toolHandlers.check_order_status>[2]
    ),
  send_product_media: (c, a, id) =>
    toolHandlers.send_product_media(
      c.organizationId,
      c.conversationId,
      c.customer.phoneNumber,
      {
        jerseyId: a.jerseyId !== undefined ? String(a.jerseyId) : undefined,
        team: a.team !== undefined ? String(a.team) : undefined,
        kitType: a.kitType !== undefined ? String(a.kitType) : undefined,
        idempotencyKey: `${c.conversationId}:${id}`
      }
    ),
  create_checkout: (c, a, id) =>
    toolHandlers.create_checkout(
      c.organizationId,
      c.conversationId,
      c.customer.phoneNumber,
      {
        jerseyId: a.jerseyId !== undefined ? String(a.jerseyId) : undefined,
        team: a.team !== undefined ? String(a.team) : undefined,
        kitType: a.kitType !== undefined ? String(a.kitType) : undefined,
        size: a.size as Parameters<typeof toolHandlers.create_checkout>[3]['size'],
        quantity: a.quantity !== undefined ? Number(a.quantity) : undefined,
        customName: a.customName !== undefined ? String(a.customName) : undefined,
        customNumber: a.customNumber !== undefined ? String(a.customNumber) : undefined,
        shippingAddress: a.shippingAddress !== undefined ? String(a.shippingAddress) : undefined,
        idempotencyKey: `${c.conversationId}:${id}`
      }
    ),
  update_order_shipping_address: (c, a, id) =>
    toolHandlers.update_order_shipping_address(
      c.organizationId,
      c.conversationId,
      c.customer.id,
      {
        shippingAddress: String(a.shippingAddress || ''),
        orderNumber: a.orderNumber !== undefined ? (a.orderNumber as string | number) : undefined,
        deliveryNotes: a.deliveryNotes !== undefined ? String(a.deliveryNotes) : undefined,
        idempotencyKey: `${c.conversationId}:${id}`
      }
    )
};

class UsageMeter {
  costUsd = 0;
  promptTokens = 0;
  completionTokens = 0;
  models: string[] = [];

  add(provider: AiProvider, res: AiResponse): void {
    this.promptTokens += res.usage.promptTokens;
    this.completionTokens += res.usage.completionTokens;
    this.costUsd += provider.estimateCostUsd(res.usage.promptTokens, res.usage.completionTokens);
    const name = provider.getModelName();
    if (!this.models.includes(name)) this.models.push(name);
  }
}

interface ParsedCall {
  call: ToolCall;
  args: Record<string, unknown>;
}

/** Validate every tool call BEFORE executing any of them. Returns null if anything is malformed. */
function parseToolCalls(calls: ToolCall[]): ParsedCall[] | null {
  const parsed: ParsedCall[] = [];
  for (const call of calls.slice(0, MAX_TOOL_CALLS_PER_TURN)) {
    if (!TOOL_EXECUTORS[call.function.name]) return null;
    try {
      const args: unknown = JSON.parse(call.function.arguments || '{}');
      if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
      parsed.push({ call, args: args as Record<string, unknown> });
    } catch {
      return null;
    }
  }
  return parsed;
}

/**
 * Evaluates whether an LLM turn plan is valid.
 * - If tools are requested: validates all calls exist with parseable arguments.
 * - If no tools are requested: valid as long as non-empty text response is provided.
 * - Does NOT escalate simply because zero tools were called (e.g. greetings like "Hi").
 */
function evaluatePlan(res: AiResponse): { ok: boolean; parsed: ParsedCall[] } {
  if (res.toolCalls && res.toolCalls.length > 0) {
    const parsed = parseToolCalls(res.toolCalls);
    return { ok: parsed !== null, parsed: parsed ?? [] };
  }
  return { ok: Boolean(res.text?.trim()), parsed: [] };
}

export async function runAgentTurn(
  providers: AiProviders,
  startTier: ModelTier,
  baseMessages: ChatMessage[],
  ctx: AgentContext
): Promise<AgentResult> {
  const meter = new UsageMeter();
  const messages: ChatMessage[] = [...baseMessages];
  const toolsCalled: string[] = [];
  let tier: ModelTier = startTier;
  let escalated = false;

  // ── Phase 1: Planning (LLM Call #1) ─────────────────────────────────────────
  // Escalation occurs strictly BEFORE any tool runs.
  let plan: AiResponse | null = null;
  let evaluation = { ok: false, parsed: [] as ParsedCall[] };

  try {
    plan = await providers[tier].generateResponse(messages, AI_TOOLS);
    meter.add(providers[tier], plan);
    evaluation = evaluatePlan(plan);
  } catch (err: unknown) {
    if (tier === 'smart') throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[AI Agent] ${providers.fast.getModelName()} failed, escalating to smart:`, msg);
  }

  // Pre-tool escalation gate: if fast model produced an invalid plan or failed, escalate to smart
  if (!plan || !evaluation.ok) {
    if (tier === 'fast') {
      tier = 'smart';
      escalated = true;
      try {
        plan = await providers.smart.generateResponse(messages, AI_TOOLS);
        meter.add(providers.smart, plan);
        evaluation = evaluatePlan(plan);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[AI Agent] ${providers.smart.getModelName()} also failed:`, msg);
        plan = null;
      }
    }
  }

  if (!plan) {
    return { text: null, ...snapshot(meter), toolsCalled, escalated };
  }

  // ── Phase 2: Conversational reply without tools ──────────────────────────────
  if (evaluation.parsed.length === 0) {
    return { text: plan.text, ...snapshot(meter), toolsCalled, escalated };
  }

  // ── Phase 3: Execute validated tools once with idempotency ──────────────────
  messages.push({
    role: 'assistant',
    content: plan.text,
    toolCalls: evaluation.parsed.map((p) => p.call)
  });

  for (const { call, args } of evaluation.parsed) {
    const name = call.function.name;
    toolsCalled.push(name);
    let output: unknown;
    try {
      output = await TOOL_EXECUTORS[name](ctx, args, call.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Tool execution failed';
      output = { error: msg };
    }
    messages.push({ role: 'tool', toolCallId: call.id, name, content: JSON.stringify(output) });
  }

  // ── Phase 4: Customer reply synthesis (LLM Call #2) ─────────────────────────
  let final = await providers[tier].generateResponse(messages);
  meter.add(providers[tier], final);

  // If fast tier fails to synthesize text, retry synthesis on smart model (safe: tools won't re-run)
  if (!final.text?.trim() && tier === 'fast') {
    escalated = true;
    final = await providers.smart.generateResponse(messages);
    meter.add(providers.smart, final);
  }

  return { text: final.text, ...snapshot(meter), toolsCalled, escalated };
}

function snapshot(m: UsageMeter) {
  return {
    costUsd: m.costUsd,
    promptTokens: m.promptTokens,
    completionTokens: m.completionTokens,
    models: [...m.models]
  };
}
