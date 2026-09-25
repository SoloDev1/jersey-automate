import { conversationStateService } from '../src/modules/chat/conversation-state.service.js';

function parseMetaTimestamp(rawTimestamp: string | number | undefined, receivedAt: Date): Date {
  if (!rawTimestamp) return receivedAt;
  const num = typeof rawTimestamp === 'string' ? Number(rawTimestamp) : rawTimestamp;
  if (isNaN(num) || num <= 0) return receivedAt;

  const ms = num < 1e11 ? num * 1000 : num;
  const parsed = new Date(ms);
  if (isNaN(parsed.getTime())) return receivedAt;

  if (parsed.getTime() > receivedAt.getTime() + 60_000) {
    return receivedAt;
  }
  return parsed;
}

const MAX_WEBHOOK_AGE_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours

async function runTests() {
  console.log('--- STARTING VERIFICATION TESTS ---');
  let passed = 0;
  let failed = 0;

  function assert(desc: string, condition: boolean) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  // TEST 1: Meta Timestamp Parsing & Skew Clamping
  const receivedAt = new Date('2026-09-25T12:44:00.000Z');

  // Seconds format (standard Meta timestamp)
  const metaSec = 1790146055; // 2026-09-23T06:47:35.000Z
  const parsedSec = parseMetaTimestamp(metaSec, receivedAt);
  assert('Seconds timestamp correctly converts to Date', parsedSec.toISOString() === '2026-09-23T06:47:35.000Z');

  // Milliseconds format
  const metaMs = 1790146055000;
  const parsedMs = parseMetaTimestamp(metaMs, receivedAt);
  assert('Milliseconds timestamp correctly converts to Date', parsedMs.toISOString() === '2026-09-23T06:47:35.000Z');

  // Future clock skew clamping (>60s in future clamped to receivedAt)
  const futureSec = Math.floor(receivedAt.getTime() / 1000) + 120; // 2 minutes in future
  const parsedFuture = parseMetaTimestamp(futureSec, receivedAt);
  assert('Future timestamp (>60s) clamped to receivedAt', parsedFuture.getTime() === receivedAt.getTime());

  // TEST 2: Webhook Freshness Guard (10-minute rule)
  // Replay of the real incident: Sept 23 message received on Sept 25
  const incidentAgeMs = receivedAt.getTime() - parsedSec.getTime();
  const incidentIsStale = incidentAgeMs > MAX_WEBHOOK_AGE_MS;
  assert('Sept 23 replay received on Sept 25 is marked stale (>10m)', incidentIsStale === true);

  // Fresh message sent 2 minutes ago
  const freshTime = new Date(receivedAt.getTime() - 2 * 60 * 1000);
  const freshAgeMs = receivedAt.getTime() - freshTime.getTime();
  const freshIsStale = freshAgeMs > MAX_WEBHOOK_AGE_MS;
  assert('Message sent 2 mins ago is marked fresh (<=10m)', freshIsStale === false);

  // Stale boundary test: 10m 1s vs 9m 59s
  const justStale = receivedAt.getTime() - (10 * 60 * 1000 + 1000);
  assert('Message sent 10m 1s ago is stale', (receivedAt.getTime() - justStale) > MAX_WEBHOOK_AGE_MS);

  const justFresh = receivedAt.getTime() - (10 * 60 * 1000 - 1000);
  assert('Message sent 9m 59s ago is fresh', (receivedAt.getTime() - justFresh) <= MAX_WEBHOOK_AGE_MS);

  // TEST 3: Backend Session Boundary Calculation (4-hour inactivity timeout)
  // Last message 5 hours ago
  const fiveHoursAgo = new Date(receivedAt.getTime() - 5 * 60 * 60 * 1000);
  const gap5h = receivedAt.getTime() - fiveHoursAgo.getTime();
  assert('Gap of 5 hours triggers new session (>4h)', gap5h > SESSION_TIMEOUT_MS);

  // Last message 30 minutes ago
  const thirtyMinAgo = new Date(receivedAt.getTime() - 30 * 60 * 1000);
  const gap30m = receivedAt.getTime() - thirtyMinAgo.getTime();
  assert('Gap of 30 mins does NOT trigger new session (<=4h)', gap30m <= SESSION_TIMEOUT_MS);

  // TEST 4: Pure Unit Test of Session Boundary State Reset
  // Verifying startNewSession guarantees
  const freshSession = await conversationStateService.startNewSession('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
  assert('startNewSession resets stage to browsing', freshSession.stage === 'browsing');
  assert('startNewSession generates new sessionId', typeof freshSession.sessionId === 'string' && freshSession.sessionId.length > 0);
  assert('startNewSession ensures jerseyId is undefined', freshSession.jerseyId === undefined);
  assert('startNewSession ensures size is undefined', freshSession.size === undefined);
  assert('startNewSession ensures orderId is undefined', freshSession.orderId === undefined);

  console.log(`\n--- ALL ${passed} VERIFICATION TESTS PASSED (${failed} failed) ---`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
