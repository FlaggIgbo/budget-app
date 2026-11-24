import db = require('../models');
import envConfigModule = require('../config/env.config');
const { getEnvConfig } = envConfigModule;
import otpServiceModule = require('../services/authentication/otp.service');
const { isSandboxMode, SANDBOX_PHONE, SANDBOX_OTP } = otpServiceModule;
import secretsVault = require('../services/banking/secrets.vault');

const SANDBOX_EMAIL = 'alex@budgetapp.local';
const SANDBOX_FIRST_NAME = 'Alex';
const SANDBOX_LAST_NAME = 'Demo';

// Format a YYYY-MM-DD date string N months back from today, clamping the day cleanly
function formatRelativeDate(monthsAgo, targetDay) {
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth() - monthsAgo;
  const maxDayInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const maxAllowedDay = monthsAgo === 0 ? Math.min(targetDay, now.getDate()) : targetDay;
  const safeDay = Math.max(1, Math.min(maxAllowedDay, maxDayInMonth));
  const date = new Date(year, monthIndex, safeDay);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Build deterministic development enrollments, accounts, and 3-month transaction history
function buildDevelopmentBankSeed(userId) {
  const enrollments = [
    {
      enrollmentId: 'dev_enr_chase',
      accessToken: secretsVault.encryptToken('dev-seed-chase'),
      institutionName: 'Chase',
      syncCursor: 'dev_cursor_chase',
      userId,
    },
    {
      enrollmentId: 'dev_enr_amex',
      accessToken: secretsVault.encryptToken('dev-seed-amex'),
      institutionName: 'American Express',
      syncCursor: 'dev_cursor_amex',
      userId,
    },
  ];

  const accounts = [
    {
      accountId: 'dev_acc_chase_chk',
      enrollmentId: 'dev_enr_chase',
      userId,
      name: 'Total Checking',
      lastFour: '4421',
      type: 'depository',
      subtype: 'checking',
      institutionName: 'Chase',
      balance: 4250.0,
      syncCursor: 'dev_cursor_chase',
    },
    {
      accountId: 'dev_acc_chase_sav',
      enrollmentId: 'dev_enr_chase',
      userId,
      name: 'Premier Savings',
      lastFour: '8890',
      type: 'depository',
      subtype: 'savings',
      institutionName: 'Chase',
      balance: 12000.0,
      syncCursor: 'dev_cursor_chase',
    },
    {
      accountId: 'dev_acc_amex_card',
      enrollmentId: 'dev_enr_amex',
      userId,
      name: 'Blue Cash Preferred',
      lastFour: '3005',
      type: 'credit',
      subtype: 'credit_card',
      institutionName: 'American Express',
      balance: -1399.25,
      syncCursor: 'dev_cursor_amex',
    },
  ];

  const transactions = [
    // Current month
    {
      transactionId: 'dev_txn_m0_1',
      accountId: 'dev_acc_chase_chk',
      enrollmentId: 'dev_enr_chase',
      userId,
      date: formatRelativeDate(0, 1),
      description: 'Acme Corp Direct Deposit',
      amount: 3225.0,
      category: 'Income',
      accountName: 'Total Checking',
      institutionName: 'Chase',
    },
    {
      transactionId: 'dev_txn_m0_2',
      accountId: 'dev_acc_chase_chk',
      enrollmentId: 'dev_enr_chase',
      userId,
      date: formatRelativeDate(0, 2),
      description: 'Avalon Communities Rent',
      amount: -1850.0,
      category: 'Rent And Utilities',
      accountName: 'Total Checking',
      institutionName: 'Chase',
    },
    {
      transactionId: 'dev_txn_m0_3',
      accountId: 'dev_acc_chase_chk',
      enrollmentId: 'dev_enr_chase',
      userId,
      date: formatRelativeDate(0, 5),
      description: 'Con Edison Electric',
      amount: -118.4,
      category: 'Rent And Utilities',
      accountName: 'Total Checking',
      institutionName: 'Chase',
    },
    {
      transactionId: 'dev_txn_m0_4',
      accountId: 'dev_acc_amex_card',
      enrollmentId: 'dev_enr_amex',
      userId,
      date: formatRelativeDate(0, 7),
      description: 'Whole Foods Market',
      amount: -164.8,
      category: 'Food And Drink',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
    },
    {
      transactionId: 'dev_txn_m0_5',
      accountId: 'dev_acc_amex_card',
      enrollmentId: 'dev_enr_amex',
      userId,
      date: formatRelativeDate(0, 10),
      description: 'Target',
      amount: -114.2,
      category: 'General Merchandise',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
    },
    {
      transactionId: 'dev_txn_m0_6',
      accountId: 'dev_acc_amex_card',
      enrollmentId: 'dev_enr_amex',
      userId,
      date: formatRelativeDate(0, 12),
      description: 'Blue Bottle Coffee',
      amount: -18.5,
      category: 'Food And Drink',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
    },
    {
      transactionId: 'dev_txn_m0_7',
      accountId: 'dev_acc_chase_chk',
      enrollmentId: 'dev_enr_chase',
      userId,
      date: formatRelativeDate(0, 15),
      description: 'Acme Corp Direct Deposit',
      amount: 3225.0,
      category: 'Income',
      accountName: 'Total Checking',
      institutionName: 'Chase',
    },
    {
      transactionId: 'dev_txn_m0_8',
      accountId: 'dev_acc_amex_card',
      enrollmentId: 'dev_enr_amex',
      userId,
      date: formatRelativeDate(0, 16),
      description: "Trader Joe's",
      amount: -92.35,
      category: 'Food And Drink',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
    },
    {
      transactionId: 'dev_txn_m0_9',
      accountId: 'dev_acc_amex_card',
      enrollmentId: 'dev_enr_amex',
      userId,
      date: formatRelativeDate(0, 18),
      description: 'Uber Trip',
      amount: -42.6,
      category: 'Transportation',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
    },
    {
      transactionId: 'dev_txn_m0_10',
      accountId: 'dev_acc_amex_card',
      enrollmentId: 'dev_enr_amex',
      userId,
      date: formatRelativeDate(0, 19),
      description: 'Spotify & Netflix',
      amount: -34.98,
      category: 'Entertainment',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
    },

    // Last month
    {
      transactionId: 'dev_txn_m1_1',
      accountId: 'dev_acc_chase_chk',
      enrollmentId: 'dev_enr_chase',
      userId,
      date: formatRelativeDate(1, 1),
      description: 'Acme Corp Direct Deposit',
      amount: 3100.0,
      category: 'Income',
      accountName: 'Total Checking',
      institutionName: 'Chase',
    },
    {
      transactionId: 'dev_txn_m1_2',
      accountId: 'dev_acc_chase_chk',
      enrollmentId: 'dev_enr_chase',
      userId,
      date: formatRelativeDate(1, 2),
      description: 'Avalon Communities Rent',
      amount: -1850.0,
      category: 'Rent And Utilities',
      accountName: 'Total Checking',
      institutionName: 'Chase',
    },
    {
      transactionId: 'dev_txn_m1_3',
      accountId: 'dev_acc_chase_chk',
      enrollmentId: 'dev_enr_chase',
      userId,
      date: formatRelativeDate(1, 6),
      description: 'Con Edison Electric',
      amount: -132.1,
      category: 'Rent And Utilities',
      accountName: 'Total Checking',
      institutionName: 'Chase',
    },
    {
      transactionId: 'dev_txn_m1_4',
      accountId: 'dev_acc_amex_card',
      enrollmentId: 'dev_enr_amex',
      userId,
      date: formatRelativeDate(1, 11),
      description: 'Whole Foods Market',
      amount: -412.5,
      category: 'Food And Drink',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
    },
    {
      transactionId: 'dev_txn_m1_5',
      accountId: 'dev_acc_chase_chk',
      enrollmentId: 'dev_enr_chase',
      userId,
      date: formatRelativeDate(1, 15),
      description: 'Acme Corp Direct Deposit',
      amount: 3100.0,
      category: 'Income',
      accountName: 'Total Checking',
      institutionName: 'Chase',
    },
    {
      transactionId: 'dev_txn_m1_6',
      accountId: 'dev_acc_amex_card',
      enrollmentId: 'dev_enr_amex',
      userId,
      date: formatRelativeDate(1, 18),
      description: 'Amazon Marketplace',
      amount: -319.4,
      category: 'General Merchandise',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
    },
    {
      transactionId: 'dev_txn_m1_7',
      accountId: 'dev_acc_amex_card',
      enrollmentId: 'dev_enr_amex',
      userId,
      date: formatRelativeDate(1, 21),
      description: 'Metro Transit Pass',
      amount: -132.0,
      category: 'Transportation',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
    },
    {
      transactionId: 'dev_txn_m1_8',
      accountId: 'dev_acc_amex_card',
      enrollmentId: 'dev_enr_amex',
      userId,
      date: formatRelativeDate(1, 24),
      description: 'Sweetgreen & Dining',
      amount: -248.0,
      category: 'Food And Drink',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
    },

    // Two months ago
    {
      transactionId: 'dev_txn_m2_1',
      accountId: 'dev_acc_chase_chk',
      enrollmentId: 'dev_enr_chase',
      userId,
      date: formatRelativeDate(2, 1),
      description: 'Acme Corp Direct Deposit',
      amount: 3100.0,
      category: 'Income',
      accountName: 'Total Checking',
      institutionName: 'Chase',
    },
    {
      transactionId: 'dev_txn_m2_2',
      accountId: 'dev_acc_chase_chk',
      enrollmentId: 'dev_enr_chase',
      userId,
      date: formatRelativeDate(2, 2),
      description: 'Avalon Communities Rent',
      amount: -1850.0,
      category: 'Rent And Utilities',
      accountName: 'Total Checking',
      institutionName: 'Chase',
    },
    {
      transactionId: 'dev_txn_m2_3',
      accountId: 'dev_acc_amex_card',
      enrollmentId: 'dev_enr_amex',
      userId,
      date: formatRelativeDate(2, 12),
      description: 'Groceries & Dining',
      amount: -585.25,
      category: 'Food And Drink',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
    },
    {
      transactionId: 'dev_txn_m2_4',
      accountId: 'dev_acc_chase_chk',
      enrollmentId: 'dev_enr_chase',
      userId,
      date: formatRelativeDate(2, 15),
      description: 'Acme Corp Direct Deposit',
      amount: 3100.0,
      category: 'Income',
      accountName: 'Total Checking',
      institutionName: 'Chase',
    },
    {
      transactionId: 'dev_txn_m2_5',
      accountId: 'dev_acc_amex_card',
      enrollmentId: 'dev_enr_amex',
      userId,
      date: formatRelativeDate(2, 20),
      description: 'General Shopping',
      amount: -275.0,
      category: 'General Merchandise',
      accountName: 'Blue Cash Preferred',
      institutionName: 'American Express',
    },
  ];

  return { enrollments, accounts, transactions };
}

// Create development test user + sample bank accounts and transactions (strictly non-production only)
async function seedSandboxUser() {
  if (getEnvConfig().isProduction || !isSandboxMode()) {
    return null;
  }

  try {
    const [user, created] = await db.User.findOrCreate({
      where: { phone: SANDBOX_PHONE },
      defaults: {
        firstName: SANDBOX_FIRST_NAME,
        lastName: SANDBOX_LAST_NAME,
        phone: SANDBOX_PHONE,
        email: SANDBOX_EMAIL,
        password: null,
      },
    });

    if (created || user.isNewRecord) {
      console.log(
        `Created development test user: ${SANDBOX_FIRST_NAME} ${SANDBOX_LAST_NAME} <${SANDBOX_EMAIL}> / ${SANDBOX_PHONE} (OTP: ${SANDBOX_OTP})`
      );
    }

    // Seed sample enrollments, accounts, and transactions if this dev user has no enrollments yet
    const existingEnrollments = await db.Enrollment.count({ where: { userId: user.id } });
    if (existingEnrollments === 0) {
      const seedData = buildDevelopmentBankSeed(user.id);

      for (const enrollment of seedData.enrollments) {
        await db.Enrollment.findOrCreate({
          where: { enrollmentId: enrollment.enrollmentId },
          defaults: enrollment,
        });
      }

      for (const account of seedData.accounts) {
        await db.Account.findOrCreate({
          where: { accountId: account.accountId },
          defaults: account,
        });
      }

      for (const txn of seedData.transactions) {
        await db.Transaction.findOrCreate({
          where: { transactionId: txn.transactionId },
          defaults: txn,
        });
      }

      console.log(
        `Seeded development bank data for ${SANDBOX_PHONE}: ${seedData.enrollments.length} institutions, ${seedData.accounts.length} accounts, ${seedData.transactions.length} transactions`
      );
    }

    return user;
  } catch (err) {
    console.error('Failed to seed development test data:', err.message);
    return null;
  }
}

export = {
  SANDBOX_EMAIL,
  SANDBOX_FIRST_NAME,
  SANDBOX_LAST_NAME,
  buildDevelopmentBankSeed,
  seedSandboxUser,
};
