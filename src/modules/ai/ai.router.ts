import type { ModelTier } from './providers/openai.provider.js';

export interface RouteInput {
  userMessage: string;
  historyLength?: number;
}

export type RouteDecision =
  | {
      type: 'agent';
      tier: ModelTier;
      reason: string;
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
 * Layer 2: Deterministic complexity router.
 * Evaluates whether an in-scope sales message requires the 'smart' reasoning model
 * or can be handled by the cost-effective 'fast' model.
 */
const COMPLEXITY_RULES: Array<{
  reason: string;
  test: (input: RouteInput) => boolean;
}> = [
  {
    // Customer dissatisfaction or disputes require nuanced tone and policy adherence
    reason: 'complaint_or_dispute',
    test: ({ userMessage }) =>
      /\b(refund|complain|scam|fraud|wrong (size|item|jersey)|damaged|not (yet )?(delivered|received)|never (got|received)|disappointed|cancel(l?ed|l?ing)? (my )?order|return|exchange|chargeback)\b/i.test(
        userMessage
      )
  },
  {
    // Payment discrepancies need exact financial reasoning
    reason: 'payment_problem',
    test: ({ userMessage }) =>
      /\b(debited|deducted|paid but|payment (failed|issue|problem|not (showing|confirmed)))\b/i.test(
        userMessage
      )
  },
  {
    // High-intent purchase decisions involving custom name printing and delivery logistics
    reason: 'checkout_or_customization',
    test: ({ userMessage }) =>
      /\b(i('ll| will)? (take|buy|order)|i want (it|this|to (buy|order))|buy (it|this)|order (it|this)|checkout|pay(ment)? link|custom (name|print)|print (my )?name|deliver(y|ed)? to|delivery address)\b/i.test(
        userMessage
      )
  },
  {
    // Post-purchase order modifications and address updates require careful state guardrails
    reason: 'order_address_or_delivery_update',
    test: ({ userMessage }) =>
      /\b(change|update|wrong|modify|correct|edit)\b.{0,80}\b(address|location|destination|delivery|street|house|apartment|flat)\b/i.test(
        userMessage
      ) ||
      /\b(new address|different address|deliver to another|send to another|change where you('re)? sending)\b/i.test(
        userMessage
      ) ||
      /\b(delivery note|gate code|leave (it|the package) with|call (me|when)|instructions for (the )?driver)\b/i.test(
        userMessage
      )
  },
  {
    // Subjective recommendations, comparative gift evaluations, or explicit budget constraints
    reason: 'advice_or_budget_comparison',
    test: ({ userMessage }) =>
      /\b(gift|recommend|suggest|advise|which (one|jersey|kit)|what (should|would) (i|you)|budget|cheaper|cheapest|difference|compare|versus|vs\.?|worth|quality|authentic|original|fake)\b/i.test(
        userMessage
      ) || /\b(under|below|around|about|max|within)\s*[₦n]?\s*\d/i.test(userMessage)
  }
];

/**
 * Evaluates customer messages with zero LLM overhead:
 * 1. Screens for obvious out-of-scope abuse (returning static redirect with 0 token cost).
 * 2. Assigns 'smart' tier to high-stakes sales, complaints, or custom print requests.
 * 3. Defaults standard catalog browsing, stock queries, and kit questions to 'fast' tier.
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

  // 2. Layer 2 Complexity Screening for In-Scope Messages
  for (const rule of COMPLEXITY_RULES) {
    if (rule.test(input)) {
      return {
        type: 'agent',
        tier: 'smart',
        reason: rule.reason
      };
    }
  }

  // 3. Default: Predictable catalog inquiries, greetings, and stock checks route to 'fast'
  return {
    type: 'agent',
    tier: 'fast',
    reason: 'standard_catalog_inquiry'
  };
}
