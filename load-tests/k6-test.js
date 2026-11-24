import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom Metrics
const authDurationTrend = new Trend('auth_duration_ms');
const transactionFetchTrend = new Trend('transaction_fetch_duration_ms');
const chatLatencyTrend = new Trend('chat_ai_duration_ms');
const errorRate = new Rate('failed_requests_rate');
const transactionSuccessCounter = new Counter('successful_transactions_fetched');

// Load Test Configuration Options
export const options = {
  scenarios: {
    // 1. Standard Load / Smoke Test
    standard_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 25 }, // Ramp up to 25 concurrent users
        { duration: '1m', target: 25 },  // Sustain load
        { duration: '15s', target: 0 },  // Graceful ramp down
      ],
      gracefulRampDown: '10s',
    },
    // 2. Stress / Spike Test (Uncomment when running spike tests)
    /*
    stress_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 80 },  // Fast spike to 80 VUs
        { duration: '40s', target: 80 },  // Hold peak
        { duration: '20s', target: 0 },   // Cool down
      ],
    },
    */
    // 3. Chaos Test Scenario (Uncomment when evaluating database/queue resilience)
    /*
    chaos_scenario: {
      executor: 'constant-vus',
      vus: 10,
      duration: '45s',
    },
    */
  },
  thresholds: {
    http_req_duration: ['p(95)<600', 'p(99)<1200'], // 95% under 600ms
    failed_requests_rate: ['rate<0.02'],             // Error rate under 2%
    transaction_fetch_duration_ms: ['p(95)<400'],    // Transaction queries under 400ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Setup function: pre-authenticates or initializes state
export function setup() {
  console.log(`Initializing Budget App k6 load test on ${BASE_URL}...`);
  // TODO: Authenticate test user and return session cookie / JWT token
  /*
  const loginRes = http.post(`${BASE_URL}/api/auth/otp/verify`, JSON.stringify({
    phone: '+15551234567',
    code: '123456',
  }), { headers: { 'Content-Type': 'application/json' } });
  
  const token = loginRes.json('token');
  return { token: token };
  */
  return { token: 'mock-test-token', startTime: new Date().toISOString() };
}

export default function (data) {
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.token}`,
  };

  group('Authentication & User Profile', () => {
    testFetchProfile(authHeaders);
  });

  group('Banking & Financial Aggregation', () => {
    testFetchAccounts(authHeaders);
    testFetchTransactions(authHeaders);
    testCreateBudgetEntry(authHeaders);
  });

  group('AI Financial Assistant', () => {
    testAiChatPrompt(authHeaders);
  });

  group('Chaos & Resilience Stubs', () => {
    testChaosRapidWebhookPayload(authHeaders);
    testChaosExpiredSessionRecovery(authHeaders);
  });

  sleep(1); // Inter-request pacing
}

// ---------------------------------------------------------------------------
// Load Test Function Stubs
// ---------------------------------------------------------------------------

export function testFetchProfile(headers) {
  // TODO: Call GET /api/profile and verify session parsing latency
  const res = http.get(`${BASE_URL}/api/profile`, { headers });
  
  const success = check(res, {
    'profile endpoint responded': (r) => r.status === 200 || r.status === 401, // 401 if mock token
  });
  errorRate.add(!success);
}

export function testFetchAccounts(headers) {
  // TODO: Query linked bank accounts and balances
  const res = http.get(`${BASE_URL}/api/bank/accounts`, { headers });

  const success = check(res, {
    'accounts status is valid': (r) => r.status === 200 || r.status === 401,
  });
  errorRate.add(!success);
}

export function testFetchTransactions(headers) {
  const start = Date.now();
  // TODO: Add date range filters (?startDate=...&endDate=...) and pagination params
  const res = http.get(`${BASE_URL}/api/bank/transactions?limit=50`, { headers });
  transactionFetchTrend.add(Date.now() - start);

  const success = check(res, {
    'transactions status is valid': (r) => r.status === 200 || r.status === 401,
  });

  if (success && r.status === 200) transactionSuccessCounter.add(1);
  errorRate.add(!success);
}

export function testCreateBudgetEntry(headers) {
  // TODO: POST new transaction/budget item to test database write performance
  const payload = JSON.stringify({
    name: 'Groceries',
    amount: 54.20,
    category: 'Food & Dining',
    date: new Date().toISOString(),
  });

  /*
  const res = http.post(`${BASE_URL}/api/transactions`, payload, { headers });
  check(res, {
    'budget entry created': (r) => r.status === 201,
  });
  */
}

export function testAiChatPrompt(headers) {
  // TODO: Test AI assistant chat endpoint streaming latency and token consumption
  const payload = JSON.stringify({
    message: 'What was my highest expense category this month?',
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/chat`, payload, { headers });
  chatLatencyTrend.add(Date.now() - start);

  check(res, {
    'chat responded': (r) => r.status === 200 || r.status === 401,
  });
}

// ---------------------------------------------------------------------------
// Chaos & Fault Injection Function Stubs
// ---------------------------------------------------------------------------

export function testChaosRapidWebhookPayload(headers) {
  // TODO: Simulate high-volume burst of out-of-order Plaid webhook notifications to test RabbitMQ backpressure and idempotency deduplication
  const fakeWebhookPayload = JSON.stringify({
    webhook_type: 'TRANSACTIONS',
    webhook_code: 'SYNC_UPDATES_AVAILABLE',
    item_id: 'test_item_123',
  });

  // Example: Fire webhook endpoint
  /*
  const res = http.post(`${BASE_URL}/api/bank/webhook`, fakeWebhookPayload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, {
    'webhook accepted': (r) => r.status === 200 || r.status === 202,
  });
  */
}

export function testChaosExpiredSessionRecovery(headers) {
  // TODO: Test client behavior when Redis session is unexpectedly flushed mid-session
  const invalidHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer expired_or_corrupt_jwt',
  };

  const res = http.get(`${BASE_URL}/api/profile`, { headers: invalidHeaders });
  check(res, {
    'clean 401 returned on invalid token without unhandled rejection': (r) => r.status === 401,
  });
}

// Teardown function: runs after load test completes
export function teardown(data) {
  console.log(`Budget App load test finished. Started at: ${data.startTime}`);
  // TODO: Clean up test accounts or purge ephemeral test transactions
}
