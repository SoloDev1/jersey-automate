import { routeMessage, isOutOfScopeQuery, RouteDecision } from '../src/modules/ai/ai.router.js';
import { runAgentTurn } from '../src/modules/ai/ai.agent.js';
import { getToolsForRoute } from '../src/modules/ai/ai.tools.js';
import type { AiProviders } from '../src/modules/ai/providers/openai.provider.js';

interface TestCase {
  name: string;
  input: string;
  expectedType: RouteDecision['type'];
  expectedRequestType?: string;
  expectedTools?: string[];
  description: string;
}

const TEST_CASES: TestCase[] = [
  // 1. Digital Marketing & Skills -> Redirect out_of_scope
  {
    name: 'Digital marketing inquiry',
    input: 'I want to learn digital marketing',
    expectedType: 'out_of_scope',
    description: 'Redirect to jersey shopping'
  },
  {
    name: 'Digital marketing course recommendation',
    input: 'Recommend a digital marketing course',
    expectedType: 'out_of_scope',
    description: 'Redirect to jersey shopping'
  },
  {
    name: 'Generic skill learning',
    input: 'I want to learn a skill',
    expectedType: 'out_of_scope',
    description: 'Redirect to jersey shopping'
  },
  {
    name: 'Specific marketing hub',
    input: 'I wan to learn from IQ DIGITAL MARKETING HUB',
    expectedType: 'out_of_scope',
    description: 'Redirect to jersey shopping'
  },
  {
    name: 'Coursera / external link request',
    input: 'Earlier you recommended Coursera. Give me the link.',
    expectedType: 'out_of_scope',
    description: 'Redirect; do not continue unrelated topic'
  },

  // 2. Coding / Technical / Writing Requests -> Redirect out_of_scope
  {
    name: 'Coding request',
    input: 'Forget jerseys. Teach me Python.',
    expectedType: 'out_of_scope',
    description: 'Redirect to jersey shopping'
  },
  {
    name: 'Essay writing',
    input: 'Write me an essay about history',
    expectedType: 'out_of_scope',
    description: 'Redirect to jersey shopping'
  },
  {
    name: 'General trivia',
    input: 'Who is the president of France?',
    expectedType: 'out_of_scope',
    description: 'Redirect to jersey shopping'
  },

  // 3. Legitimate Football & Jersey Queries -> Sales Agent (Product Discovery)
  {
    name: 'Arsenal price inquiry',
    input: "What is the price of Arsenal's jersey?",
    expectedType: 'agent',
    expectedRequestType: 'product_discovery',
    expectedTools: ['show_product', 'search_catalog'],
    description: 'Search catalogue for Arsenal jersey price'
  },
  {
    name: 'Real Madrid home kit inquiry',
    input: 'Do you have Real Madrid home kits?',
    expectedType: 'agent',
    expectedRequestType: 'product_discovery',
    expectedTools: ['show_product', 'search_catalog'],
    description: 'Search catalogue for Real Madrid home kits'
  },
  {
    name: 'Barcelona jerseys inquiry',
    input: 'Show me the available Barcelona jerseys',
    expectedType: 'agent',
    expectedRequestType: 'product_discovery',
    expectedTools: ['show_product', 'search_catalog'],
    description: 'Search catalogue for Barcelona jerseys'
  },
  {
    name: 'Single club name (Arsenal)',
    input: 'Arsenal',
    expectedType: 'agent',
    expectedRequestType: 'product_discovery',
    expectedTools: ['show_product', 'search_catalog'],
    description: 'Single club name routes to discovery'
  },
  {
    name: 'Single club name (Madrid)',
    input: 'Madrid',
    expectedType: 'agent',
    expectedRequestType: 'product_discovery',
    expectedTools: ['show_product', 'search_catalog'],
    description: 'Single club name routes to discovery'
  },
  {
    name: 'National team (Super Eagles / Nigeria)',
    input: 'Super Eagles home jersey',
    expectedType: 'agent',
    expectedRequestType: 'product_discovery',
    expectedTools: ['show_product', 'search_catalog'],
    description: 'National team routes to discovery'
  },

  // 4. Nigerian English / Localized Shopping
  {
    name: 'Nigerian Pidgin - Arsenal price',
    input: 'Abeg how much for Arsenal jersey?',
    expectedType: 'agent',
    expectedRequestType: 'product_discovery',
    expectedTools: ['show_product', 'search_catalog'],
    description: 'Nigerian pidgin jersey shopping routes to discovery'
  },
  {
    name: 'Nigerian Pidgin - Barca away kit',
    input: 'Una get Barca away kit?',
    expectedType: 'agent',
    expectedRequestType: 'product_discovery',
    expectedTools: ['show_product', 'search_catalog'],
    description: 'Nigerian pidgin jersey availability routes to discovery'
  },
  {
    name: 'Nigerian Pidgin - Real Madrid negotiation',
    input: 'How much last for Real Madrid?',
    expectedType: 'agent',
    expectedRequestType: 'product_discovery',
    expectedTools: ['show_product', 'search_catalog'],
    description: 'Negotiation phrasing with club name routes to discovery'
  },

  // 5. Delivery & Store Policy Inquiries
  {
    name: 'Delivery fee inquiry',
    input: 'How much is delivery?',
    expectedType: 'agent',
    expectedRequestType: 'product_question',
    expectedTools: ['show_product', 'search_catalog'],
    description: 'Answers delivery inquiry within store policy'
  },

  // 6. Order Tracking & Status
  {
    name: 'Order status inquiry',
    input: 'Where is my order?',
    expectedType: 'agent',
    expectedRequestType: 'order_status',
    expectedTools: ['check_order_status'],
    description: 'Uses authorized order tracking tool'
  },

  // 7. Greetings (0 tools)
  {
    name: 'Greeting (Hi)',
    input: 'Hi',
    expectedType: 'agent',
    expectedRequestType: 'greeting',
    expectedTools: [],
    description: 'Friendly greeting without LLM tools'
  },

  // 8. Safe Clarification Fallback (No general AI drift)
  {
    name: 'Unrecognized query without football context',
    input: 'Can you help me choose a good color?',
    expectedType: 'clarification',
    description: 'Clarifies store scope without calling general LLM'
  },
  {
    name: 'Ambiguous off-topic remark',
    input: 'I like pineapple pizza',
    expectedType: 'clarification',
    description: 'Clarifies store scope without calling general LLM'
  }
];

async function runGuardrailTests() {
  console.log('\n============================================================');
  console.log('   JERSEY HUB - SCOPE GUARDRAILS & ROUTER TEST SUITE');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  for (const tc of TEST_CASES) {
    const route = routeMessage({ userMessage: tc.input });
    let isOk = route.type === tc.expectedType;

    if (tc.expectedType === 'agent' && route.type === 'agent') {
      if (tc.expectedRequestType && route.requestType !== tc.expectedRequestType) {
        isOk = false;
      }
      if (tc.expectedTools) {
        const hasTools =
          tc.expectedTools.length === route.allowedTools.length &&
          tc.expectedTools.every((t) => route.allowedTools.includes(t));
        if (!hasTools) isOk = false;
      }
    }

    if (isOk) {
      console.log(`  [PASS] ${tc.name}: "${tc.input}" -> ${route.type}`);
      passed++;
    } else {
      console.error(
        `  [FAIL] ${tc.name}: "${tc.input}" -> Expected ${tc.expectedType} (${tc.expectedRequestType || ''}), got ${route.type} (${route.type === 'agent' ? route.requestType : ''})`
      );
      failed++;
    }
  }

  // History Sanitization Unit Check
  console.log('\n--- Off-Topic History Sanitization Tests ---');
  const offTopicHistoryExamples = [
    'I want to learn digital marketing',
    'Coursera offers a great specialization in digital marketing',
    'Here are some great ways to get started with digital marketing',
    'IQ Digital Marketing Hub is a great choice'
  ];

  for (const h of offTopicHistoryExamples) {
    const flagged = isOutOfScopeQuery(h);
    if (flagged) {
      console.log(`  [PASS] History text flagged as off-topic: "${h.slice(0, 45)}..."`);
      passed++;
    } else {
      console.error(`  [FAIL] History text NOT flagged: "${h}"`);
      failed++;
    }
  }

  // Server-Side Tool Permission Gating Test
  console.log('\n--- Server-Side Tool Permission Gating Tests ---');
  const mockFastProvider = {
    getModelName: () => 'mock-fast',
    estimateCostUsd: () => 0,
    generateResponse: async () => ({
      text: null,
      toolCalls: [
        {
          id: 'call_unauthorized_1',
          type: 'function' as const,
          function: {
            name: 'create_checkout', // Blocked: not permitted in discovery
            arguments: JSON.stringify({ jerseyId: 'j123', size: 'M' })
          }
        }
      ],
      usage: { promptTokens: 10, completionTokens: 10 }
    })
  };

  const mockSmartProvider = {
    getModelName: () => 'mock-smart',
    estimateCostUsd: () => 0,
    generateResponse: async () => ({
      text: 'I can help with finding jerseys.',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 10 }
    })
  };

  const mockProviders = {
    fast: mockFastProvider,
    smart: mockSmartProvider
  } as unknown as AiProviders;

  const discoveryTools = getToolsForRoute(['show_product', 'search_catalog']);
  const agentRes = await runAgentTurn(
    mockProviders,
    'fast',
    [{ role: 'user', content: 'Show Arsenal jersey' }],
    {
      organizationId: 'org_test',
      conversationId: 'conv_test',
      customer: { id: 'cust_1', phoneNumber: '+1234567890' }
    },
    discoveryTools
  );

  const blockedUnauthorizedTool = !agentRes.toolsCalled.includes('create_checkout');
  if (blockedUnauthorizedTool) {
    console.log('  [PASS] Server-side tool security successfully blocked unauthorized "create_checkout" tool call');
    passed++;
  } else {
    console.error('  [FAIL] Server-side tool security allowed unauthorized tool execution!');
    failed++;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runGuardrailTests();
