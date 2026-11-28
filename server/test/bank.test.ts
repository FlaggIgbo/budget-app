// Bank service, Event-Driven Plaid Webhooks, RabbitMQ Domain Event Bus,
// MinIO/R2 Statement Storage, and LLM Chat tests
import { describe, it, before, beforeEach, after } from 'node:test';
import assert = require('node:assert');
import crypto = require('crypto');
import app = require('../app');
import request = require('./helpers/httpClient');
import { createMockAmqpBroker } from './helpers/mockAmqp';
import bankService = require('../services/banking/bank.service');
import bankAdapter = require('../services/banking/plaid.adapter');
import plaidWebhook = require('../services/banking/plaid.webhook');
import eventBus = require('../services/events/eventBus.service');
import queueService = require('../services/jobs/queue.service');
import pushServiceModule = require('../push_service');
const { pushQueue } = pushServiceModule;
import storageService = require('../services/infrastructure/storage.service');
import llmService = require('../services/ai/llm.service');
import sentryService = require('../services/infrastructure/sentry.service');

function toBase64Url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createSignedPlaidWebhookJwt(rawBody: string, privateKey: crypto.KeyObject, kid: string) {
  const header = toBase64Url(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }));
  const requestBodySha256 = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
  const payload = toBase64Url(
    JSON.stringify({
      iat: Math.floor(Date.now() / 1000),
      request_body_sha256: requestBodySha256,
    })
  );
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${toBase64Url(signature)}`;
}

describe('Bank Service, Plaid Webhooks, RabbitMQ Event Bus, Statement Storage & LLM Assistant', () => {
  let db;
  let testUser;
  let mockAmqp;

  const originalDeleteEnrollment = bankAdapter.deleteEnrollment;
  const originalGetAccounts = bankAdapter.getAccounts;
  const originalSyncTransactions = bankAdapter.syncTransactions;
  const originalGetWebhookVerificationKey = bankAdapter.getWebhookVerificationKey;

  before(async () => {
    process.env.NODE_ENV = 'test';
    bankAdapter.deleteEnrollment = async () => true;
    db = require('../models');
    await db.sequelize.sync({ force: true });
    testUser = await db.User.create({
      firstName: 'Bank',
      lastName: 'Tester',
      phone: '+15550001111',
      email: 'bankuser@example.com',
    });

    mockAmqp = createMockAmqpBroker();
    eventBus.setChannelFactory(mockAmqp.channelFactory);
    await queueService.startSyncConsumer();
    await pushQueue.startPushConsumer();
  });

  beforeEach(() => {
    mockAmqp.reset();
    plaidWebhook.clearWebhookKeyCache();
    bankAdapter.getAccounts = originalGetAccounts;
    bankAdapter.syncTransactions = originalSyncTransactions;
    bankAdapter.getWebhookVerificationKey = originalGetWebhookVerificationKey;
  });

  after(() => {
    bankAdapter.deleteEnrollment = originalDeleteEnrollment;
    bankAdapter.getAccounts = originalGetAccounts;
    bankAdapter.syncTransactions = originalSyncTransactions;
    bankAdapter.getWebhookVerificationKey = originalGetWebhookVerificationKey;
    eventBus.setChannelFactory(null);
  });

  it('encrypts and decrypts bank access tokens at rest in Secrets Vault', () => {
    const rawToken = 'access-sandbox-secret-123';
    const encrypted = bankService.encryptToken(rawToken);
    assert.notStrictEqual(encrypted, rawToken);
    assert.ok(encrypted.includes(':'), 'expected IV:ciphertext format');

    const decrypted = bankService.decryptToken(encrypted);
    assert.strictEqual(decrypted, rawToken);
  });

  it('normalizes Plaid accounts and transactions (inverting outflow/inflow signs)', () => {
    const normalizedAcct = bankAdapter.normalizeAccount({
      account_id: 'plaid_acc_1',
      name: 'Plaid Checking',
      mask: '0000',
      type: 'depository',
      subtype: 'checking',
      balances: { current: 110, available: 100 },
    });
    assert.strictEqual(normalizedAcct.id, 'plaid_acc_1');
    assert.strictEqual(normalizedAcct.last_four, '0000');
    assert.strictEqual(normalizedAcct.type, 'depository');

    const expenseTxn = bankAdapter.normalizeTransaction({
      transaction_id: 'plaid_txn_1',
      account_id: 'plaid_acc_1',
      date: '2026-11-10',
      merchant_name: 'Coffee Shop',
      amount: 5.5,
      personal_finance_category: { primary: 'FOOD_AND_DRINK' },
    });
    assert.strictEqual(expenseTxn.amount, -5.5);
    assert.strictEqual(expenseTxn.category, 'Food And Drink');

    const incomeTxn = bankAdapter.normalizeTransaction({
      transaction_id: 'plaid_txn_2',
      account_id: 'plaid_acc_1',
      date: '2026-11-01',
      name: 'Direct Deposit',
      amount: -2500,
      personal_finance_category: { primary: 'INCOME' },
    });
    assert.strictEqual(incomeTxn.amount, 2500);
    assert.strictEqual(incomeTxn.category, 'Income');
  });

  it('creates enrollments asynchronously via bank.enrollment.created event and keeps GET reads strictly Postgres-only', async () => {
    let livePlaidCalls = 0;
    bankAdapter.getAccounts = async () => {
      livePlaidCalls += 1;
      return [];
    };
    bankAdapter.syncTransactions = async () => {
      livePlaidCalls += 1;
      return { added: [], modified: [], removed: [], nextCursor: null, hasMore: false };
    };

    const created = await bankService.createEnrollment(testUser.id, {
      accessToken: 'token_async_1',
      enrollmentId: 'enr_async_1',
      institutionName: 'Async Bank',
      publicToken: null,
    });
    assert.strictEqual(created.enrollmentId, 'enr_async_1');
    assert.strictEqual(
      livePlaidCalls,
      0,
      'createEnrollment must not call Plaid sync synchronously'
    );

    const enrollmentEvents = mockAmqp.getPublishedEvents(
      eventBus.DomainEvents.BANK_ENROLLMENT_CREATED
    );
    assert.strictEqual(enrollmentEvents.length, 1);
    assert.strictEqual(enrollmentEvents[0].envelope.payload.enrollmentId, 'enr_async_1');
    assert.strictEqual(enrollmentEvents[0].properties.priority, queueService.PRIORITY_HIGH);

    // GET-backed service methods must read strictly from PostgreSQL without triggering lazy Plaid syncs
    const accounts = await bankService.listStoredAccounts(testUser.id);
    const txns = await bankService.listStoredTransactions(testUser.id);
    const summary = await bankService.getDashboardSummary(testUser.id, 3);
    assert.strictEqual(accounts.length, 0);
    assert.strictEqual(txns.length, 0);
    assert.strictEqual(summary.recentTransactions.length, 0);
    assert.strictEqual(livePlaidCalls, 0, 'GET endpoints must never trigger inline Plaid syncs');

    // Clean up enrollment for subsequent tests
    await db.Enrollment.destroy({ where: { enrollmentId: 'enr_async_1' } });
  });

  it('calculates net worth from persisted Account records without live API calls', async () => {
    await db.Enrollment.create({
      enrollmentId: 'enr_1',
      accessToken: bankService.encryptToken('token_1'),
      institutionName: 'Chase',
      syncCursor: 'txn_expense_1',
      userId: testUser.id,
    });

    await db.Account.create({
      accountId: 'acc_checking_1',
      enrollmentId: 'enr_1',
      userId: testUser.id,
      name: 'Everyday Checking',
      lastFour: '1111',
      type: 'depository',
      subtype: 'checking',
      institutionName: 'Chase',
      balance: 2500.5,
      syncCursor: 'txn_expense_1',
    });

    await db.Account.create({
      accountId: 'acc_credit_1',
      enrollmentId: 'enr_1',
      userId: testUser.id,
      name: 'Rewards Card',
      lastFour: '2222',
      type: 'credit',
      subtype: 'credit_card',
      institutionName: 'Chase',
      balance: -400.25,
    });

    const result = await bankService.getNetWorth(testUser.id);
    assert.strictEqual(result.totalAssets, 2500.5);
    assert.strictEqual(result.totalLiabilities, 400.25);
    assert.strictEqual(result.netWorth, 2100.25);
    assert.strictEqual(result.accounts.length, 2);
  });

  it('computes dashboard summary and filters transactions per institution', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);

    await db.Transaction.create({
      transactionId: 'txn_income_1',
      accountId: 'acc_checking_1',
      enrollmentId: 'enr_1',
      userId: testUser.id,
      date: `${currentMonth}-05`,
      description: 'Paycheck',
      amount: 3000,
      category: 'Income',
      accountName: 'Everyday Checking',
      institutionName: 'Chase',
    });

    await db.Transaction.create({
      transactionId: 'txn_expense_1',
      accountId: 'acc_checking_1',
      enrollmentId: 'enr_1',
      userId: testUser.id,
      date: `${currentMonth}-10`,
      description: 'Grocery Store',
      amount: -150.75,
      category: 'Groceries',
      accountName: 'Everyday Checking',
      institutionName: 'Chase',
    });

    const summary = await bankService.getDashboardSummary(testUser.id, 3);
    assert.strictEqual(summary.quickStats.thisMonthIncome, 3000);
    assert.strictEqual(summary.quickStats.thisMonthExpenses, 150.75);
    assert.strictEqual(summary.spendingByCategory.length, 1);
    assert.strictEqual(summary.spendingByCategory[0].category, 'Groceries');
    assert.strictEqual(summary.spendingByCategory[0].amount, 150.75);
    assert.strictEqual(summary.recentTransactions.length, 2);

    const chaseTxns = await bankService.listStoredTransactions(testUser.id, {
      institutionName: 'Chase',
    });
    assert.strictEqual(chaseTxns.length, 2);
  });

  it('verifies Plaid webhooks (ES256 JWT + SHA-256), triggers async RabbitMQ sync, and emits bank.sync.completed to Push queue', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const publicJwk = publicKey.export({ format: 'jwk' });
    const kid = 'plaid-test-kid-1';

    bankAdapter.getWebhookVerificationKey = async (requestedKid) =>
      requestedKid === kid ? publicJwk : null;

    // 1. Missing Plaid-Verification header is rejected (401)
    const missingHeaderRes = await request(app).post('/api/bank/webhooks/plaid').send({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: 'enr_1',
    });
    assert.strictEqual(missingHeaderRes.status, 401);

    // 2. Body hash mismatch is rejected (401)
    const wrongHashJwt = createSignedPlaidWebhookJwt('{"tampered":true}', privateKey, kid);
    const badHashRes = await request(app)
      .post('/api/bank/webhooks/plaid')
      .set('Plaid-Verification', wrongHashJwt)
      .send({
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: 'enr_1',
      });
    assert.strictEqual(badHashRes.status, 401);

    // 3. Valid TRANSACTIONS:SYNC_UPDATES_AVAILABLE webhook emits domain event -> sync consumer -> bank.sync.completed -> push queue
    const syncPayload = {
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: 'enr_1',
    };
    const syncRawBody = JSON.stringify(syncPayload);
    const validJwt = createSignedPlaidWebhookJwt(syncRawBody, privateKey, kid);

    bankAdapter.getAccounts = async () => [
      {
        id: 'acc_checking_1',
        name: 'Everyday Checking',
        last_four: '1111',
        type: 'depository',
        subtype: 'checking',
        balances: { current: 2500.5 },
      },
    ];
    bankAdapter.syncTransactions = async () => ({
      added: [],
      modified: [],
      removed: [],
      nextCursor: 'cursor_after_webhook',
      hasMore: false,
    });

    const okRes = await request(app)
      .post('/api/bank/webhooks/plaid')
      .set('Plaid-Verification', validJwt)
      .send(syncPayload);
    assert.strictEqual(okRes.status, 200);
    assert.strictEqual(okRes.body.ok, true);
    assert.strictEqual(okRes.body.eventType, eventBus.DomainEvents.PLAID_SYNC_UPDATES_AVAILABLE);

    // Sync queue received the Plaid webhook event; push queue has NOT received anything yet
    assert.strictEqual(mockAmqp.getQueueMessages(queueService.SYNC_QUEUE_NAME).length, 1);
    assert.strictEqual(mockAmqp.getQueueMessages(pushQueue.PUSH_QUEUE_NAME).length, 0);

    // Drain the RabbitMQ sync consumer -> updates enrollment cursor and emits `bank.sync.completed`
    await mockAmqp.drainNext(queueService.SYNC_QUEUE_NAME);

    const updatedEnrollment = await db.Enrollment.findOne({ where: { enrollmentId: 'enr_1' } });
    assert.strictEqual(updatedEnrollment.syncCursor, 'cursor_after_webhook');

    const completedEvents = mockAmqp.getPublishedEvents(eventBus.DomainEvents.BANK_SYNC_COMPLETED);
    assert.strictEqual(completedEvents.length, 1);
    assert.strictEqual(completedEvents[0].envelope.payload.userId, testUser.id);
    assert.strictEqual(completedEvents[0].envelope.payload.syncedCount, 1);

    // Push queue independently received `bank.sync.completed` via RabbitMQ topic binding
    const pushMsgs = mockAmqp.getQueueMessages(pushQueue.PUSH_QUEUE_NAME);
    assert.strictEqual(pushMsgs.length, 1);
    assert.strictEqual(pushMsgs[0].json.type, eventBus.DomainEvents.BANK_SYNC_COMPLETED);

    // 4. Valid ITEM:ERROR webhook emits `plaid.webhook.item_error` directly to Push queue
    mockAmqp.reset();
    const errorPayload = {
      webhook_type: 'ITEM',
      webhook_code: 'ERROR',
      item_id: 'enr_1',
      error: { error_code: 'ITEM_LOGIN_REQUIRED' },
    };
    const errorJwt = createSignedPlaidWebhookJwt(JSON.stringify(errorPayload), privateKey, kid);
    const errWebhookRes = await request(app)
      .post('/api/bank/webhooks/plaid')
      .set('Plaid-Verification', errorJwt)
      .send(errorPayload);
    assert.strictEqual(errWebhookRes.status, 200);
    assert.strictEqual(errWebhookRes.body.eventType, eventBus.DomainEvents.PLAID_ITEM_ERROR);

    const pushAlertMsgs = mockAmqp.getQueueMessages(pushQueue.PUSH_QUEUE_NAME);
    assert.strictEqual(pushAlertMsgs.length, 1);
    assert.strictEqual(pushAlertMsgs[0].json.type, eventBus.DomainEvents.PLAID_ITEM_ERROR);
  });

  it('prioritizes login events ahead of Plaid webhooks and manual sync requests in RabbitMQ priority queue', async () => {
    // 1. Manual sync request (PRIORITY_NORMAL = 1)
    await queueService.enqueueUserSyncJob(testUser.id, { source: 'manual' });

    // 2. Plaid webhook event (PRIORITY_WEBHOOK = 5)
    await eventBus.publishEvent(
      eventBus.DomainEvents.PLAID_SYNC_UPDATES_AVAILABLE,
      { userId: testUser.id, enrollmentId: 'enr_1', source: 'plaid_webhook' },
      { priority: queueService.PRIORITY_WEBHOOK }
    );

    // 3. Login event (PRIORITY_HIGH = 10)
    await eventBus.publishEvent(
      eventBus.DomainEvents.USER_LOGGED_IN,
      { userId: testUser.id, source: 'login' },
      { priority: queueService.PRIORITY_HIGH }
    );

    const queued = mockAmqp.getQueueMessages(queueService.SYNC_QUEUE_NAME);
    assert.strictEqual(queued.length, 3);
    assert.strictEqual(queued[0].json.type, eventBus.DomainEvents.USER_LOGGED_IN);
    assert.strictEqual(queued[0].properties.priority, queueService.PRIORITY_HIGH);
    assert.strictEqual(queued[1].json.type, eventBus.DomainEvents.PLAID_SYNC_UPDATES_AVAILABLE);
    assert.strictEqual(queued[1].properties.priority, queueService.PRIORITY_WEBHOOK);
    assert.strictEqual(queued[2].json.type, eventBus.DomainEvents.BANK_SYNC_REQUESTED);
    assert.strictEqual(queued[2].properties.priority, queueService.PRIORITY_NORMAL);
  });

  it('combines PostgreSQL financial data and MinIO/R2 statement storage in LLM chat assistant stub', async () => {
    const uploadStub = await storageService.uploadBankStatement(
      testUser.id,
      { institutionName: 'Chase', statementPeriod: '2026-11', fileName: 'nov.pdf' },
      Buffer.from('PDF_STUB')
    );
    assert.strictEqual(uploadStub.todo, true);
    assert.strictEqual(uploadStub.bucket, 'budget-statements');

    const chatRes = await llmService.askFinancialAssistant(testUser.id, 'How should I budget?');
    assert.strictEqual(chatRes.todo, true);
    assert.strictEqual(chatRes.contextSummary.netWorth, 2100.25);
    assert.strictEqual(chatRes.contextSummary.thisMonthIncome, 3000);
    assert.strictEqual(chatRes.contextSummary.thisMonthExpenses, 150.75);
    assert.ok(chatRes.reply.includes('How should I budget?'));
  });

  it('records exceptions in Sentry stub', () => {
    sentryService.clearCapturedEvents();
    sentryService.captureException(new Error('Test Sentry exception'), { component: 'bank.test' });
    const events = sentryService.getCapturedEvents();
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].message, 'Test Sentry exception');
  });

  it('disconnects an institution and cascade deletes its accounts and transactions', async () => {
    const deleted = await bankService.deleteEnrollment(testUser.id, 'enr_1');
    assert.strictEqual(deleted, true);

    const remainingAccounts = await bankService.listStoredAccounts(testUser.id);
    const remainingTxns = await bankService.listStoredTransactions(testUser.id);
    assert.strictEqual(remainingAccounts.length, 0);
    assert.strictEqual(remainingTxns.length, 0);
  });
});
