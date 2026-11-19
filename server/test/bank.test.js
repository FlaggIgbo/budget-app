// Bank service, RabbitMQ Priority Queue & Daily CRON, MinIO/R2 Statement Storage, and LLM Chat tests
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const bankService = require('../services/bank.service');
const bankAdapter = require('../services/plaid.adapter');
const queueService = require('../services/queue.service');
const cronScheduler = require('../services/cron.scheduler');
const storageService = require('../services/storage.service');
const llmService = require('../services/llm.service');
const sentryService = require('../services/sentry.service');

describe('Bank Service, RabbitMQ Queue, Statement Storage & LLM Assistant', () => {
  let db;
  let testUser;

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

  it('prioritizes login sync jobs ahead of daily CRON sync jobs in RabbitMQ queue', async () => {
    queueService.clearPendingJobs();

    // Enqueue daily cron job (normal priority = 1)
    const cronRes = await cronScheduler.runDailySyncCron();
    assert.strictEqual(cronRes.usersQueued, 1);

    // Enqueue login job (high priority = 10)
    await queueService.enqueueUserSyncJob(testUser.id, { source: 'login' });

    const pending = queueService.getPendingJobs();
    assert.strictEqual(pending.length, 2);
    assert.strictEqual(pending[0].source, 'login');
    assert.strictEqual(pending[0].priority, queueService.PRIORITY_HIGH);
    assert.strictEqual(pending[1].source, 'daily_cron');
    assert.strictEqual(pending[1].priority, queueService.PRIORITY_NORMAL);
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
