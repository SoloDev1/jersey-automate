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
    }
  | {
      type: 'clarification';
      reason: string;
      clarificationMessage: string;
    };

export const STORE_SCOPE_REDIRECT =
  "⚽ I am the Jersey Hub sales assistant! I am here exclusively to help you find club and national team football jerseys, check size stock, and place orders. How can I help with your jersey shopping today?";

export const STORE_CLARIFICATION_MESSAGE =
  "⚽ I can help you find football jerseys, check available sizes, or track an order at Jersey Hub! Which football club, national team, or jersey are you looking for?";

/**
 * Layer 1: Deterministic zero-cost out-of-scope filters.
 * Rejects off-topic non-store queries immediately with 0 OpenAI tokens spent.
 */
export const OUT_OF_SCOPE_RULES: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: 'digital_marketing_or_skills',
    pattern:
      /\b(digital marketing|learn(ing)?\s+(a\s+)?(new\s+)?skill|learn(ing)?\s+(coding|programming|seo|marketing|graphic design|tech)|learn\s+from\s+iq|iq\s+digital)\b/i
  },
  {
    reason: 'education_or_courses',
    pattern:
      /\b(recommend|suggest|find)\s+(me\s+)?(a\s+)?(course|career|university|college|school|tutorial|bootcamp|certificate)\b/i
  },
  {
    reason: 'external_learning_platforms',
    pattern:
      /\b(coursera|udemy|edx|khan academy|hubspot|neil patel|linkedin learning|google digital garage)\b/i
  },
  {
    reason: 'external_links_or_unrelated_requests',
    pattern:
      /\b(give me the link|send (me )?the link|need the link|share the link|website link)\b/i
  },
  {
    reason: 'coding_or_software',
    pattern:
      /\b(write (me )?(a |some )?(python|javascript|typescript|code|script|program|sql|html|css)|build (me )?(a )?(website|app|bot)|fix (my )?code|teach\s+me\s+python|forget\s+jerseys|stop\s+talking\s+about\s+jerseys)\b/i
  },
  {
    reason: 'academic_or_creative_writing',
    pattern:
      /\b(write (me )?(an? |some )?(2000-word )?(essay|poem|song|story)|(do|solve) (my )?(homework|assignment|math|calculus|equation))\b/i
  },
  {
    reason: 'general_trivia_or_crypto',
    pattern:
      /\b(who is the president|weather (forecast|today)|explain (bitcoin|crypto|blockchain|quantum physics)|stock market advice|investing advice)\b/i
  },
  {
    reason: 'unrelated_products',
    pattern:
      /\b(buy\s+(a\s+)?(car|house|phone|laptop|crypto|bitcoin)|real estate|flight booking|hotel reservation)\b/i
  }
];

export function isOutOfScopeQuery(text: string): boolean {
  const trimmed = text.trim();
  return OUT_OF_SCOPE_RULES.some((rule) => rule.pattern.test(trimmed));
}

/**
 * Well-known football clubs, national teams, and leagues.
 * Ensures short queries like "Madrid", "Arsenal", or "Chelsea" route to product discovery.
 */
const FOOTBALL_TEAMS_PATTERN =
  /\b(arsenal|chelsea|liverpool|manchester\s*united|man\s*utd|man\s*united|man\s*city|manchester\s*city|tottenham|spurs|newcastle|aston\s*villa|west\s*ham|everton|brighton|wolves|leicester|real\s*madrid|madrid|barcelona|barca|barça|atletico(\s*madrid)?|sevilla|valencia|juventus|juve|inter(\s*milan)?|ac\s*milan|milan|napoli|roma|lazio|bayern(\s*munich)?|dortmund|borussia\s*dortmund|leverkusen|psg|paris\s*saint-germain|marseille|ajax|benfica|sporting|porto|al\s*nassr|inter\s*miami|nigeria|super\s*eagles|brazil|argentina|france|england|portugal|germany|spain|italy|netherlands|holland|world\s*cup|champions\s*league|premier\s*league|la\s*liga|serie\s*a)\b/i;

/**
 * Core football jersey shopping keywords and Nigerian shopping phrasing.
 */
const SHOPPING_INTENT_PATTERN =
  /\b(jersey|jerseys|kits?|football kit|home kit|away kit|third kit|player version|fan version|retro kit|retro|tracksuit|shirt|shirts?|size\s*[smlx0-9]+|small|medium|large|xl|xxl|2xl|3xl|price|prices|cost|how much|stock|available|availability|in stock|buy|purchase|order|catalogue|catalog|delivery|shipping|custom print|printing|abeg|una get|wetin be the price|how much last)\b/i;

/**
 * Evaluates customer messages with zero LLM overhead:
 * 1. Screens for obvious out-of-scope abuse (returning static redirect with 0 token cost).
 * 2. Applies Dynamic Tool Gating:
 *    - Greetings / General Chit-Chat -> tools: [] (saves ~930 prompt tokens)
 *    - Order tracking -> tools: ['check_order_status']
 *    - Address update -> tools: ['update_order_shipping_address', 'check_order_status']
 *    - Inquiries on store policy/delivery -> requestType: 'product_question', tools: ['show_product', 'search_catalog']
 *    - Complaints / Disputes -> 'smart' tier, tools: ['show_product', 'search_catalog']
 *    - Verified shopping / discovery -> tools: ['show_product', 'search_catalog']
 * 3. Never sends an unknown/ambiguous message to the general AI agent by default.
 *    Instead, returns a fixed clarification prompt with $0 token cost.
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
    /\b(order\s*(status|number|update|tracking)|track(ing)?|where is my (order|jersey|package|parcel)|has my (order|jersey) (shipped|delivered)|status of my order)\b/i.test(
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
      allowedTools: ['show_product', 'search_catalog']
    };
  }

  // 6. Delivery, Shipping Policy, or Store Inquiries
  const isDeliveryOrStorePolicy =
    /\b(how much is delivery|delivery (cost|fee|charge|rate|price)|shipping (cost|fee|charge|rate|price)|do you deliver to|where do you deliver|how long does delivery take|pickup|pick up)\b/i.test(
      trimmed
    );

  if (isDeliveryOrStorePolicy) {
    return {
      type: 'agent',
      tier: 'fast',
      reason: 'delivery_or_policy_inquiry',
      requestType: 'product_question',
      allowedTools: ['show_product', 'search_catalog']
    };
  }

  // 7. Verified Shopping Intent or Football Club Recognition
  const matchesFootballTeam = FOOTBALL_TEAMS_PATTERN.test(trimmed);
  const matchesShoppingIntent = SHOPPING_INTENT_PATTERN.test(trimmed);

  if (matchesFootballTeam || matchesShoppingIntent) {
    return {
      type: 'agent',
      tier: 'fast',
      reason: matchesFootballTeam ? 'club_discovery' : 'shopping_intent',
      requestType: 'product_discovery',
      allowedTools: ['show_product', 'search_catalog']
    };
  }

  // 8. Safe Fallback: Clarification within Store Scope (Zero LLM Overhead)
  // Never pass an unknown/ambiguous request to the general LLM agent.
  return {
    type: 'clarification',
    reason: 'unclear_non_shopping_intent',
    clarificationMessage: STORE_CLARIFICATION_MESSAGE
  };
}
