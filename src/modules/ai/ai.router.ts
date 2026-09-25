import type { ModelTier } from './providers/openai.provider.js';

export interface RouteInput {
  userMessage: string;
  historyLength?: number;
}

export type RequestType =
  | 'greeting'
  | 'product_discovery'
  | 'product_question'
  | 'order_status'
  | 'support_or_address'
  | 'fallback';

export type RouteDecision =
  | {
      type: 'agent';
      tier: ModelTier;
      reason: string;
      requestType: RequestType;
      allowedTools: string[];
    }
  | {
      type: 'out_of_scope';
      reason: string;
      redirectMessage: string;
    };

const STORE_SCOPE_REDIRECT =
  "⚽ I am the Jersey Hub sales assistant! I am here exclusively to help you find club and national team football jerseys, check size stock, and place orders. How can I help with your jersey shopping today?";

/**
 * Layer 1: Deterministic zero-cost out-of-scope filters.
 * Rejects off-topic non-store queries immediately with 0 OpenAI tokens spent.
 */
const OUT_OF_SCOPE_RULES: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: 'coding_or_software',
    pattern:
      /\b(write (me )?(a |some )?(python|javascript|typescript|code|script|program|sql|html|css)|build (me )?(a )?(website|app|bot)|fix (my )?code)\b/i
  },
  {
    reason: 'academic_or_creative_writing',
    pattern:
      /\b(write (me )?(a )?(2000-word )?(essay|poem|song|story)|(do|solve) (my )?(homework|assignment|math|calculus|equation))\b/i
  },
  {
    reason: 'general_trivia_or_crypto',
    pattern:
      /\b(who is the president|weather (forecast|today)|explain (bitcoin|crypto|blockchain|quantum physics)|stock market advice)\b/i
  }
];

/**
 * Evaluates customer messages with zero LLM overhead:
 * 1. Screens for obvious out-of-scope abuse (returning static redirect with 0 token cost).
 * 2. Applies Dynamic Tool Gating:
 *    - Greetings / General Chit-Chat -> tools: [] (saves ~930 prompt tokens)
 *    - Order tracking -> tools: ['check_order_status']
 *    - Address update -> tools: ['update_order_shipping_address', 'check_order_status']
 *    - Discovery & inquiries -> tools: ['show_product', 'search_catalog', 'check_stock']
 * 3. Assigns 'smart' tier to complaints or custom printing; defaults other queries to 'fast' tier.
 */
export function routeMessage(input: RouteInput): RouteDecision {
  const trimmed = input.userMessage.trim();

  // 1. Layer 1 Out-of-Scope Screening
  for (const rule of OUT_OF_SCOPE_RULES) {
    if (rule.pattern.test(trimmed)) {
      return {
        type: 'out_of_scope',
        reason: rule.reason,
        redirectMessage: STORE_SCOPE_REDIRECT
      };
    }
  }

  // 2. Dynamic Tool Gating: Pure Greetings / Pleasantries (0 tools -> saves ~930 prompt tokens)
  const isShortGreeting =
    /^(hi|hello|hey|good\s*(morning|afternoon|evening)|yo|sup|hiya|help|menu|info|how\s+are\s+you)\b/i.test(
      trimmed
    ) && trimmed.split(/\s+/).length <= 4;

  if (isShortGreeting) {
    return {
      type: 'agent',
      tier: 'fast',
      reason: 'greeting_no_tools',
      requestType: 'greeting',
      allowedTools: []
    };
  }

  // 3. Dynamic Tool Gating: Order Tracking Inquiry
  const isOrderTracking =
    /\b(order\s*(status|number|update|tracking)|track(ing)?|where is my (order|jersey)|has my (order|jersey) (shipped|delivered))\b/i.test(
      trimmed
    );

  if (isOrderTracking) {
    return {
      type: 'agent',
      tier: 'fast',
      reason: 'order_tracking',
      requestType: 'order_status',
      allowedTools: ['check_order_status']
    };
  }

  // 4. Dynamic Tool Gating: Order Address / Delivery Notes
  const isAddressUpdate =
    /\b(change|update|wrong|modify|correct|edit)\b.{0,80}\b(address|location|destination|delivery|street|house|apartment|flat)\b/i.test(
      trimmed
    ) ||
    /\b(new address|different address|deliver to another|send to another|change where you('re)? sending)\b/i.test(
      trimmed
    ) ||
    /\b(delivery note|gate code|leave (it|the package) with|call (me|when)|instructions for (the )?driver)\b/i.test(
      trimmed
    );

  if (isAddressUpdate) {
    return {
      type: 'agent',
      tier: 'smart',
      reason: 'order_address_update',
      requestType: 'support_or_address',
      allowedTools: ['update_order_shipping_address', 'check_order_status']
    };
  }

  // 5. Customer Complaints / Disputes (Escalated to smart model)
  const isComplaint =
    /\b(refund|complain|scam|fraud|wrong (size|item|jersey)|damaged|not (yet )?(delivered|received)|never (got|received)|disappointed|cancel(l?ed|l?ing)? (my )?order|return|exchange|chargeback)\b/i.test(
      trimmed
    );

  if (isComplaint) {
    return {
      type: 'agent',
      tier: 'smart',
      reason: 'customer_complaint',
      requestType: 'product_question',
      allowedTools: ['show_product', 'search_catalog', 'check_stock']
    };
  }

  // 6. Default: Product Discovery & Inquiries
  return {
    type: 'agent',
    tier: 'fast',
    reason: 'standard_catalog_inquiry',
    requestType: 'product_discovery',
    allowedTools: ['show_product', 'search_catalog', 'check_stock']
  };
}
