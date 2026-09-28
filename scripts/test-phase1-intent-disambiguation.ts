import { intentExtractor } from '../src/modules/ai/ai.intent-extractor.js';
import { catalogMatcher } from '../src/modules/catalog/catalog.matcher.js';
import { normalizeTeamName } from '../src/modules/catalog/catalog.repository.js';

async function runTests() {
  console.log('🧪 Starting Phase 1 Verification: Intent Extractor & Catalog Matcher\n');

  // Test 1: Team Name Normalization & Aliases (Deterministic, 0 AI)
  console.log('=== Test 1: Team Name Normalization ===');
  const aliasTests = [
    { input: 'man city', expected: 'Manchester City' },
    { input: 'manu', expected: 'Manchester United' },
    { input: 'gunners', expected: 'Arsenal' },
    { input: 'blues', expected: 'Chelsea' },
    { input: 'barca', expected: 'Barcelona' },
    { input: 'madrid', expected: 'Real Madrid' }
  ];

  for (const t of aliasTests) {
    const normalized = normalizeTeamName(t.input);
    const pass = normalized.toLowerCase() === t.expected.toLowerCase();
    console.log(`  ${pass ? '✅' : '❌'} "${t.input}" -> "${normalized}" (expected: "${t.expected}")`);
  }

  // Test 2: Intent & Entity Extractor (Lightweight AI)
  console.log('\n=== Test 2: Intent & Entity Extractor (OpenAI) ===');
  const queries = [
    'I want Man City jersey',
    'Do you have the new Arsenal home kit?',
    'I want Hull',
    'Do you deliver to Abuja?',
    'Hello good afternoon'
  ];

  for (const q of queries) {
    try {
      const res = await intentExtractor.extract(q);
      console.log(`  Query: "${q}"`);
      console.log(`  -> Intent: ${res.data.intent}`);
      console.log(`  -> Team: ${res.data.team || 'none'}`);
      console.log(`  -> KitType: ${res.data.kitType || 'none'}`);
      console.log(`  -> Tokens: ${res.usage.totalTokens} (Prompt: ${res.usage.promptTokens}, Completion: ${res.usage.completionTokens})\n`);
    } catch (err: unknown) {
      console.error(`  ❌ Failed on query "${q}":`, err);
    }
  }

  // Test 3: Catalog Matcher & Ambiguity Logic
  console.log('=== Test 3: Catalog Matcher Ambiguity & Popular Clubs ===');
  try {
    const orgId = 'org_default';
    const popular = await catalogMatcher.getPopularActiveTeams(orgId, 3);
    console.log(`  Popular active clubs for ${orgId}:`, popular);

    const matchTest = await catalogMatcher.matchTeam(orgId, 'Arsenal');
    console.log(`  Match result for "Arsenal":`, matchTest);

    const noMatchTest = await catalogMatcher.matchTeam(orgId, 'NonExistentFCXYZ');
    console.log(`  Match result for "NonExistentFCXYZ":`, noMatchTest);
  } catch (err: unknown) {
    console.warn(`  ⚠️ Database check notice (requires live DB connection):`, err);
  }

  console.log('\n🏁 Phase 1 Test Complete!');
}

runTests().catch(console.error);
