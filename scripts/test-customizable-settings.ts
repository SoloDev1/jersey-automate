import { buildSystemPrompt } from '../src/modules/ai/prompt.builder.js';
import { routeMessage, DynamicRouteContext } from '../src/modules/ai/ai.router.js';
import { updateStoreSettingsSchema } from '../src/modules/settings/settings.schema.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { StoreSettingsDto } from '../src/modules/settings/settings.types.js';

async function runCustomizationTests() {
  console.log('\n============================================================');
  console.log('   JERSEY AUTOMATE - WHITE-LABEL & SETTINGS TEST SUITE');
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

  // ── TEST 1: Default Store Settings Prompt Generation ───────────────────
  console.log('\n[1/5] Testing Default Store Settings Prompt Generation...');
  const defaultPrompt = buildSystemPrompt(null);
  assert(
    'Default prompt includes Jersey Hub',
    defaultPrompt.includes('Jersey Hub')
  );
  assert(
    'Default prompt includes football jerseys description',
    defaultPrompt.includes('football jerseys')
  );
  assert('Default prompt includes store emoji ⚽', defaultPrompt.includes('⚽'));
  assert(
    'Default prompt contains anti-hallucination constraint',
    defaultPrompt.includes('Never invent products, prices, sizes, stock, or store policies.')
  );

  // ── TEST 2: Custom White-Label Store Prompt Generation (Sneaker Vault) ─
  console.log('\n[2/5] Testing Custom Store Prompt Generation (Sneaker Vault)...');
  const sneakerSettings: StoreSettingsDto = {
    organizationId: 'org_sneakers_123',
    storeName: 'Lagos Sneaker Vault',
    storeCategory: 'footwear',
    businessDescription: 'original premium sneakers and streetwear kicks',
    storeEmoji: '👟',
    currency: 'NGN',
    defaultShippingFee: 2500,
    customPrintingFee: 0,
    customOptionTitle: 'Gift Packaging',
    customOptionFee: 1500,
    aiPersonaTone: 'enthusiastic and trendy',
    customStorePolicies: 'Next-day delivery in Lagos. 7-day exchange policy for unworn items.',
    outOfScopeMessage: '👟 Welcome to Lagos Sneaker Vault! We exclusively sell authentic sneakers.',
    clarificationMessage: '👟 Looking for kicks? Which brand or sneaker size do you need?',
    brandKeywords: ['Nike', 'Jordan', 'Yeezy', 'Adidas', 'New Balance'],
    categoryKeywords: ['sneakers', 'kicks', 'creps', 'trainers'],
    isWhatsappConnected: true,
    aiEnabledGlobally: true,
    maxMonthlyAiBudgetUsd: 25,
    updatedAt: new Date().toISOString()
  };

  const customPrompt = buildSystemPrompt(sneakerSettings);
  assert(
    'Custom prompt dynamically names Lagos Sneaker Vault',
    customPrompt.includes('Lagos Sneaker Vault')
  );
  assert(
    'Custom prompt dynamically states sneakers description',
    customPrompt.includes('original premium sneakers')
  );
  assert(
    'Custom prompt uses custom sneaker emoji 👟',
    customPrompt.includes('👟')
  );
  assert(
    'Custom prompt includes custom store return and delivery policy',
    customPrompt.includes('Next-day delivery in Lagos. 7-day exchange policy for unworn items.')
  );
  assert(
    'Custom prompt includes optional service (Gift Packaging)',
    customPrompt.includes('Gift Packaging for NGN 1500')
  );
  assert(
    'Custom prompt enforces zero-hallucination rule',
    customPrompt.includes('Never invent products, prices, sizes, stock, or store policies.')
  );

  // ── TEST 3: Dynamic Router Brand & Keyword Recognition ─────────────────
  console.log('\n[3/5] Testing Dynamic Router with Tenant Customization...');
  const dynamicCtx: DynamicRouteContext = {
    storeName: sneakerSettings.storeName,
    storeCategory: sneakerSettings.storeCategory,
    storeEmoji: sneakerSettings.storeEmoji,
    brandKeywords: sneakerSettings.brandKeywords,
    categoryKeywords: sneakerSettings.categoryKeywords,
    outOfScopeMessage: sneakerSettings.outOfScopeMessage,
    clarificationMessage: sneakerSettings.clarificationMessage
  };

  // Test custom brand keyword
  const nikeRoute = routeMessage({ userMessage: 'Do you have Nike Air Max in stock?' }, dynamicCtx);
  assert(
    'Custom brand "Nike" routes to product_discovery without code change',
    nikeRoute.type === 'agent' && nikeRoute.requestType === 'product_discovery' && nikeRoute.reason === 'custom_brand_discovery'
  );

  // Test custom category keyword
  const kicksRoute = routeMessage({ userMessage: 'Show me available kicks' }, dynamicCtx);
  assert(
    'Custom category "kicks" routes to product_discovery',
    kicksRoute.type === 'agent' && kicksRoute.requestType === 'product_discovery' && kicksRoute.reason === 'custom_category_discovery'
  );

  // Test custom out-of-scope redirection
  const offTopicRoute = routeMessage({ userMessage: 'I want to learn digital marketing' }, dynamicCtx);
  assert(
    'Off-topic query uses custom store redirect message',
    offTopicRoute.type === 'out_of_scope' &&
      offTopicRoute.redirectMessage === '👟 Welcome to Lagos Sneaker Vault! We exclusively sell authentic sneakers.'
  );

  // Test custom clarification fallback
  const unclearRoute = routeMessage({ userMessage: 'What is the speed of light?' }, dynamicCtx);
  assert(
    'Unrecognized query uses custom store clarification message',
    unclearRoute.type === 'clarification' &&
      unclearRoute.clarificationMessage === '👟 Looking for kicks? Which brand or sneaker size do you need?'
  );

  // ── TEST 4: Zod Schema Validation for Settings API ─────────────────────
  console.log('\n[4/5] Testing Zod Schema Validation for Settings API...');
  const validUpdate = updateStoreSettingsSchema.safeParse({
    storeName: 'Gadget Empire',
    storeCategory: 'electronics',
    storeEmoji: '📱',
    currency: 'USD',
    defaultShippingFee: 15,
    customStorePolicies: '1-year warranty on all smartphones.',
    brandKeywords: ['Apple', 'Samsung', 'Google Pixel'],
    categoryKeywords: ['phone', 'laptop', 'tablet'],
    maxMonthlyAiBudgetUsd: 50
  });
  assert('Valid update payload passes Zod schema validation', validUpdate.success === true);

  const invalidUpdate = updateStoreSettingsSchema.safeParse({
    defaultShippingFee: -500 // Negative fee should fail
  });
  assert('Invalid negative fee rejected by Zod schema validation', invalidUpdate.success === false);

  // ── TEST 5: Settings Cache Invalidation ────────────────────────────────
  console.log('\n[5/5] Testing In-Memory Settings Cache...');
  const testService = new SettingsService();
  // Invalidate cache doesn't throw
  testService.invalidateCache('org_test');
  testService.invalidateCache();
  assert('Cache invalidation runs cleanly', true);

  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} assertions.\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runCustomizationTests();
