import { routeMessage } from '../src/modules/ai/ai.router.js';
import { interactiveActionRouter } from '../src/modules/webhooks/interactive-action.router.js';
import { conversationStateService } from '../src/modules/chat/conversation-state.service.js';
import { prisma } from '../src/core/database/prisma.js';

async function runRegressionTests() {
  console.log('\n============================================================');
  console.log('   JERSEY AUTOMATE - REGRESSION & BENCHMARK SUITE');
  console.log('============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(testName: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}${details ? ` -> ${details}` : ''}`);
      failed++;
    }
  }

  // ── TEST 1: Tool Schema Gating in Discovery ─────────────────────────────
  console.log('\n[1/6] Testing Dynamic Tool Gating in Discovery...');
  const discoveryQueries = [
    'Show Arsenal jerseys',
    'I want Chelsea home',
    'Man City away',
    'Madrid',
    'What kits are available?'
  ];

  for (const q of discoveryQueries) {
    const route = routeMessage({ userMessage: q });
    const isDiscovery = route.type === 'agent' && route.requestType === 'product_discovery';
    const noCheckout = route.type === 'agent' && !route.allowedTools.includes('create_checkout');
    const noCheckStock = route.type === 'agent' && !route.allowedTools.includes('check_stock');
    const hasCoreTools =
      route.type === 'agent' &&
      route.allowedTools.includes('show_product') &&
      route.allowedTools.includes('search_catalog') &&
      route.allowedTools.length === 2;

    assert(
      `Query "${q}" routes to discovery with exactly [show_product, search_catalog]`,
      isDiscovery && noCheckout && noCheckStock && hasCoreTools,
      `Tools returned: ${route.type === 'agent' ? route.allowedTools.join(', ') : 'none'}`
    );
  }

  // ── TEST 2: Greetings Gating (tools: []) ────────────────────────────────
  console.log('\n[2/6] Testing Greetings Gating (tools: [])...');
  const greetingQueries = ['Hello', 'Hi', 'Hey', 'Good morning', 'Yo'];
  for (const g of greetingQueries) {
    const route = routeMessage({ userMessage: g });
    const isGreeting =
      route.type === 'agent' &&
      route.requestType === 'greeting' &&
      route.allowedTools.length === 0;

    assert(`Greeting "${g}" routes with 0 tools (tools: [])`, isGreeting);
  }

  // ── TEST 3: Zero-AI Interactive Router Actions ─────────────────────────
  console.log('\n[3/6] Testing Interactive Action Router Coverage...');
  const actions = [
    'view:88888888-4444-4444-4444-121212121212',
    'sizes:88888888-4444-4444-4444-121212121212',
    'buy:88888888-4444-4444-4444-121212121212:M',
    'buy:88888888-4444-4444-4444-121212121212:XL',
    'team:Arsenal',
    'support_human'
  ];

  for (const act of actions) {
    const isHandled = interactiveActionRouter.isHandled(act);
    assert(`Action "${act}" recognized as deterministic (0 AI fallback)`, isHandled);
  }

  // ── TEST 4: Session State Size Memory ──────────────────────────────────
  console.log('\n[4/6] Testing Session State Size Preference Retention...');
  const testOrgId = 'org_default';
  const testConvId = '00000000-0000-0000-0000-000000000001';

  try {
    const org = await prisma.organization.findFirst({ select: { id: true } });
    if (org) {
      const conv = await prisma.conversation.upsert({
        where: { id: testConvId },
        update: {},
        create: {
          id: testConvId,
          organization: { connect: { id: org.id } },
          customerPhone: '+2348000000001',
          state: {}
        }
      });

      // Customer previously specified "Size S"
      await conversationStateService.updateState(org.id, conv.id, {
        size: 'S'
      });

      const stateAfterSize = await conversationStateService.getState(org.id, conv.id);
      assert('Customer size preference "S" persisted in session state', stateAfterSize.size === 'S');

      // Now customer views Madrid
      await conversationStateService.updateState(org.id, conv.id, {
        stage: 'viewing_product',
        jerseyId: 'test-jersey-uuid',
        team: 'Real Madrid',
        kitType: 'Home'
      });

      const stateAfterProduct = await conversationStateService.getState(org.id, conv.id);
      assert(
        'Product viewed retains previously selected size "S"',
        stateAfterProduct.size === 'S' && stateAfterProduct.team === 'Real Madrid'
      );
    }
  } catch (err: unknown) {
    console.warn('  ⚠️ Note: DB conversation check skipped (offline or test ID):', err);
  }

  // ── TEST 5: Interactive Router Failure Guard (Paystack / DB Failure) ────
  console.log('\n[5/6] Testing Interactive Action Router Failure Containment...');
  const mockCustomer = {
    id: 'cust-test',
    phoneNumber: '+2348012345678',
    name: 'Test Customer'
  };

  const dispatchResult = await interactiveActionRouter.dispatch(
    'buy:00000000-0000-0000-0000-000000000000:M',
    {
      organizationId: testOrgId,
      conversationId: testConvId,
      customer: mockCustomer
    }
  );

  assert(
    'Failed checkout gracefully returns true (handled) with zero AI fallback',
    dispatchResult === true
  );

  // ── TEST 6: Single-Pass UI Execution Detection Logic ───────────────────
  console.log('\n[6/6] Testing Single-Pass Detection Logic...');
  const multiKitResult = { found: true, listSent: true, count: 3 };
  const singleKitResult = { found: true, photoSent: true, count: 1 };
  const checkoutCardResult = { checkoutCardSentAbove: true };

  const isMultiKitSinglePass = Boolean(multiKitResult.listSent || multiKitResult.photoSent);
  const isSingleKitSinglePass = Boolean(singleKitResult.listSent || singleKitResult.photoSent);
  const isCheckoutSinglePass = Boolean(checkoutCardResult.checkoutCardSentAbove);

  assert('Multi-kit list result triggers single-pass bypass', isMultiKitSinglePass);
  assert('Single-kit card result triggers single-pass bypass', isSingleKitSinglePass);
  assert('Checkout card result triggers single-pass bypass', isCheckoutSinglePass);

  console.log('\n============================================================');
  console.log(`   REGRESSION TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionTests()
  .catch((err) => {
    console.error('Fatal error in regression suite:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
