// Bank service and API tests (Secrets Vault encryption, Sync Worker, Disconnect Handler, Net Worth, Dashboard Insights)
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const bankService = require('../services/bank.service');
const bankAdapter = require('../services/teller.adapter');

describe('Bank Service & Encryption', () => {
  let db;
  let testUser;

  before(async () => {
    process.env.NODE_ENV = 'test';
    bankAdapter.deleteEnrollment = async () => true;
    db = require('../models');
    await db.sequelize.sync({ force: true });
    testUser = await db.User.create({ email: 'bankuser@example.com' });
  });

  it('encrypts and decrypts bank access tokens at rest in Secrets Vault', () => {
    const rawToken = 'token_sandbox_secret_123';
    const encrypted = bankService.encryptToken(rawToken);
    assert.notStrictEqual(encrypted, rawToken);
    assert.ok(encrypted.includes(':'), 'expected IV:ciphertext format');

    const decrypted = bankService.decryptToken(encrypted);
    assert.strictEqual(decrypted, rawToken);
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
      type: 'deposit',
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

  it('disconnects an institution and cascade deletes its accounts and transactions', async () => {
    const deleted = await bankService.deleteEnrollment(testUser.id, 'enr_1');
    assert.strictEqual(deleted, true);

    const remainingAccounts = await bankService.listStoredAccounts(testUser.id);
    const remainingTxns = await bankService.listStoredTransactions(testUser.id);
    assert.strictEqual(remainingAccounts.length, 0);
    assert.strictEqual(remainingTxns.length, 0);
  });
});
