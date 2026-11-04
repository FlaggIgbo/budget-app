const db = require('../models');
const bankAdapter = require('./teller.adapter');
const secretsVault = require('./secrets.vault');
const syncWorker = require('./sync.worker');
const disconnectHandler = require('./disconnect.handler');

// ============================================================================
// BANK SERVICE (API SERVER BUSINESS LOGIC)
// Coordinates the Secrets Vault, Sync Worker, Disconnect Handler, and App DB.
// Written with simple loops and step-by-step logic.
// ============================================================================

// Round a number to 2 decimal places (cents)
function roundToCents(amount) {
  return Math.round(amount * 100) / 100;
}

// Get Teller Connect UI configuration (equivalent to POST /link-token)
function getConnectConfig() {
  return bankAdapter.getConnectConfig();
}

// Save bank connection in Secrets Vault and run initial Sync Worker
// (Equivalent to POST /exchange-token and POST /enrollments)
async function createEnrollment(userId, { accessToken, enrollmentId, institutionName }) {
  // Step 1: Store encrypted access_token in Secrets Vault (enrollments table)
  const enrollment = await secretsVault.storeEnrollmentToken(userId, {
    enrollmentId,
    accessToken,
    institutionName,
  });

  // Step 2: Trigger Sync Worker to pull accounts, balances, and transactions
  try {
    await syncWorker.syncEnrollmentData(enrollment, userId);
  } catch {
    // Allow enrollment save to succeed even if initial sync encounters a network error
  }

  return {
    id: enrollment.id,
    enrollmentId: enrollment.enrollmentId,
    institutionName: enrollment.institutionName,
    syncCursor: enrollment.syncCursor || null,
  };
}

// Trigger Sync Worker for one enrollment or all user enrollments (POST /transactions/sync)
async function syncUserTransactions(userId, enrollmentId = null) {
  if (enrollmentId) {
    const enrollment = await db.Enrollment.findOne({
      where: { enrollmentId, userId },
    });
    if (!enrollment) {
      return null;
    }
    const accounts = await syncWorker.syncEnrollmentData(enrollment, userId);
    return [
      {
        enrollmentId: enrollment.enrollmentId,
        institutionName: enrollment.institutionName,
        syncCursor: enrollment.syncCursor,
        accountsSynced: accounts.length,
      },
    ];
  }

  return await syncWorker.syncAllUserEnrollments(userId);
}

// List all connected bank institutions (enrollments) for a user
async function listEnrollments(userId) {
  return await db.Enrollment.findAll({
    where: { userId },
    attributes: ['id', 'enrollmentId', 'institutionName', 'syncCursor', 'createdAt'],
    order: [['createdAt', 'DESC']],
  });
}

// Get all accounts + balances from the App Database (GET /accounts)
async function listStoredAccounts(userId, enrollmentId = null) {
  const enrollments = await db.Enrollment.findAll({
    where: { userId },
  });

  let storedAccounts = await db.Account.findAll({
    where: { userId },
    order: [['createdAt', 'ASC']],
  });

  // If the user has connected banks but no cached accounts yet, run the Sync Worker once
  if (enrollments.length > 0 && storedAccounts.length === 0) {
    for (let i = 0; i < enrollments.length; i++) {
      try {
        await syncWorker.syncEnrollmentData(enrollments[i], userId);
      } catch {
        // Ignore individual enrollment sync errors
      }
    }
    storedAccounts = await db.Account.findAll({
      where: { userId },
      order: [['createdAt', 'ASC']],
    });
  }

  const results = [];
  for (let i = 0; i < storedAccounts.length; i++) {
    const a = storedAccounts[i];
    if (enrollmentId && a.enrollmentId !== enrollmentId) {
      continue;
    }

    const balance = parseFloat(a.balance) || 0;
    const accountType = (a.type || '').toLowerCase();
    const isAsset = accountType === 'deposit' || (accountType !== 'credit' && balance >= 0);

    results.push({
      id: a.accountId,
      accountId: a.accountId,
      enrollmentId: a.enrollmentId,
      name: a.name,
      lastFour: a.lastFour,
      type: a.type,
      subtype: a.subtype,
      institutionName: a.institutionName || 'Bank',
      balance: roundToCents(balance),
      syncCursor: a.syncCursor || null,
      isAsset,
    });
  }

  return results;
}

// Get persisted transactions from the App Database (GET /transactions)
// Supports filtering by enrollmentId or institutionName ("Transactions per institution")
async function listStoredTransactions(userId, filters = {}) {
  const enrollments = await db.Enrollment.findAll({
    where: { userId },
  });

  let storedTransactions = await db.Transaction.findAll({
    where: { userId },
    order: [['date', 'DESC']],
  });

  // If user has connected banks but no cached transactions yet, run Sync Worker once
  if (enrollments.length > 0 && storedTransactions.length === 0) {
    for (let i = 0; i < enrollments.length; i++) {
      try {
        await syncWorker.syncEnrollmentData(enrollments[i], userId);
      } catch {
        // Ignore individual enrollment sync errors
      }
    }
    storedTransactions = await db.Transaction.findAll({
      where: { userId },
      order: [['date', 'DESC']],
    });
  }

  const targetEnrollmentId = filters.enrollmentId || '';
  const targetInstitution = filters.institutionName || '';
  const targetAccountId = filters.accountId || '';
  const maxCount = parseInt(filters.count, 10) || 0;

  const results = [];
  for (let i = 0; i < storedTransactions.length; i++) {
    const t = storedTransactions[i];

    if (targetEnrollmentId && t.enrollmentId !== targetEnrollmentId) {
      continue;
    }
    if (targetInstitution && t.institutionName !== targetInstitution) {
      continue;
    }
    if (targetAccountId && t.accountId !== targetAccountId) {
      continue;
    }

    results.push({
      id: t.transactionId,
      transactionId: t.transactionId,
      accountId: t.accountId,
      enrollmentId: t.enrollmentId,
      date: t.date,
      description: t.description,
      amount: parseFloat(t.amount) || 0,
      category: t.category || 'Uncategorized',
      accountName: t.accountName,
      institutionName: t.institutionName || 'Bank',
    });

    if (maxCount > 0 && results.length >= maxCount) {
      break;
    }
  }

  return results;
}

// Sync and return bank accounts for a specific enrollment
async function getAccountsForEnrollment(userId, enrollmentId) {
  const enrollment = await db.Enrollment.findOne({
    where: { enrollmentId, userId },
  });

  if (!enrollment) {
    return null;
  }

  const accounts = await syncWorker.syncEnrollmentData(enrollment, userId);
  return accounts;
}

// Get live balance for a specific bank account from Teller
async function getBalancesForAccount(userId, enrollmentId, accountId) {
  const enrollment = await db.Enrollment.findOne({
    where: { enrollmentId, userId },
  });

  if (!enrollment) {
    return null;
  }

  const accessToken = secretsVault.decryptToken(enrollment.accessToken);
  return await bankAdapter.getBalances(accessToken, accountId);
}

// Get live transactions for a specific bank account from Teller
async function getTransactionsForAccount(userId, enrollmentId, accountId, params = {}) {
  const enrollment = await db.Enrollment.findOne({
    where: { enrollmentId, userId },
  });

  if (!enrollment) {
    return null;
  }

  const accessToken = secretsVault.decryptToken(enrollment.accessToken);
  return await bankAdapter.getTransactions(accessToken, accountId, params);
}

// Calculate net worth from persisted accounts in PostgreSQL
async function getNetWorth(userId) {
  const storedAccounts = await listStoredAccounts(userId);

  let totalAssets = 0;
  let totalLiabilities = 0;
  const accountList = [];

  for (let i = 0; i < storedAccounts.length; i++) {
    const a = storedAccounts[i];
    const balance = parseFloat(a.balance) || 0;
    const accountType = (a.type || '').toLowerCase();
    const isAsset = accountType === 'deposit';
    const isLiability = accountType === 'credit';

    if (isAsset) {
      totalAssets += balance;
    } else if (isLiability) {
      totalLiabilities += Math.abs(balance);
    } else if (balance >= 0) {
      totalAssets += balance;
    } else {
      totalLiabilities += Math.abs(balance);
    }

    accountList.push({
      id: a.id,
      enrollmentId: a.enrollmentId,
      name: a.name,
      lastFour: a.lastFour,
      type: a.type,
      subtype: a.subtype,
      institutionName: a.institutionName,
      balance: roundToCents(balance),
      isAsset,
    });
  }

  const netWorth = roundToCents(totalAssets - totalLiabilities);

  return {
    netWorth,
    totalAssets: roundToCents(totalAssets),
    totalLiabilities: roundToCents(totalLiabilities),
    accounts: accountList,
  };
}

// Compute monthly dashboard summary from persisted transactions in PostgreSQL
async function getDashboardSummary(userId, monthsBack = 3) {
  const enrollments = await db.Enrollment.findAll({
    where: { userId },
  });

  let storedTransactions = await db.Transaction.findAll({
    where: { userId },
  });

  // If user has connected banks but no cached transactions yet, sync once
  if (enrollments.length > 0 && storedTransactions.length === 0) {
    for (let i = 0; i < enrollments.length; i++) {
      try {
        await syncWorker.syncEnrollmentData(enrollments[i], userId);
      } catch {
        // Ignore individual enrollment sync errors
      }
    }
    storedTransactions = await db.Transaction.findAll({
      where: { userId },
    });
  }

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  // Step 1: Filter transactions within the requested date window
  const allTransactions = [];
  for (let i = 0; i < storedTransactions.length; i++) {
    const t = storedTransactions[i];
    if (t.date >= startStr && t.date <= endStr) {
      allTransactions.push(t);
    }
  }

  // Step 2: Group income and expenses by month
  const incomeByMonth = {};
  const expensesByMonth = {};

  for (let i = 0; i < allTransactions.length; i++) {
    const t = allTransactions[i];
    const amount = parseFloat(t.amount) || 0;
    const month = (t.date || '').slice(0, 7);

    if (!month) continue;

    if (amount > 0) {
      incomeByMonth[month] = (incomeByMonth[month] || 0) + amount;
    } else {
      expensesByMonth[month] = (expensesByMonth[month] || 0) + Math.abs(amount);
    }
  }

  const monthSet = new Set();
  for (const month of Object.keys(incomeByMonth)) {
    monthSet.add(month);
  }
  for (const month of Object.keys(expensesByMonth)) {
    monthSet.add(month);
  }
  const allMonths = Array.from(monthSet).sort();

  const incomeVsExpenses = [];
  for (let i = 0; i < allMonths.length; i++) {
    const m = allMonths[i];
    incomeVsExpenses.push({
      month: m,
      income: roundToCents(incomeByMonth[m] || 0),
      expenses: roundToCents(expensesByMonth[m] || 0),
    });
  }

  // Step 3: Calculate spending by category for current month
  const currentMonth = now.toISOString().slice(0, 7);
  const categoryTotals = {};

  for (let i = 0; i < allTransactions.length; i++) {
    const t = allTransactions[i];
    const month = (t.date || '').slice(0, 7);
    if (month !== currentMonth) continue;

    const amount = parseFloat(t.amount) || 0;
    if (amount >= 0) continue;

    const category = t.category || 'Uncategorized';
    categoryTotals[category] = (categoryTotals[category] || 0) + Math.abs(amount);
  }

  const spendingByCategory = [];
  const catKeys = Object.keys(categoryTotals);
  for (let i = 0; i < catKeys.length; i++) {
    const cat = catKeys[i];
    spendingByCategory.push({
      category: cat,
      amount: roundToCents(categoryTotals[cat]),
    });
  }
  spendingByCategory.sort((a, b) => b.amount - a.amount);

  // Step 4: Recent transactions (most recent 50 so per-institution filtering has plenty of items)
  allTransactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const recentTransactions = [];
  const maxRecent = Math.min(allTransactions.length, 50);

  for (let i = 0; i < maxRecent; i++) {
    const t = allTransactions[i];
    recentTransactions.push({
      id: t.transactionId,
      enrollmentId: t.enrollmentId,
      accountId: t.accountId,
      date: t.date,
      description: t.description,
      amount: parseFloat(t.amount) || 0,
      category: t.category || 'Uncategorized',
      accountName: t.accountName,
      institutionName: t.institutionName || null,
    });
  }

  // Step 5: Quick stats (this month, last month, YTD)
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = lastMonthDate.toISOString().slice(0, 7);
  const thisYear = String(now.getFullYear());

  const thisMonthIncome = incomeByMonth[currentMonth] || 0;
  const thisMonthExpenses = expensesByMonth[currentMonth] || 0;
  const lastMonthIncome = incomeByMonth[lastMonth] || 0;
  const lastMonthExpenses = expensesByMonth[lastMonth] || 0;

  let ytdIncome = 0;
  let ytdExpenses = 0;
  for (let i = 0; i < allMonths.length; i++) {
    const m = allMonths[i];
    if (m.startsWith(thisYear)) {
      ytdIncome += incomeByMonth[m] || 0;
      ytdExpenses += expensesByMonth[m] || 0;
    }
  }

  let momIncomeChange = 0;
  if (lastMonthIncome > 0) {
    momIncomeChange = ((thisMonthIncome - lastMonthIncome) / lastMonthIncome) * 100;
  }

  let momExpensesChange = 0;
  if (lastMonthExpenses > 0) {
    momExpensesChange = ((thisMonthExpenses - lastMonthExpenses) / lastMonthExpenses) * 100;
  }

  return {
    incomeVsExpenses,
    spendingByCategory,
    recentTransactions,
    quickStats: {
      thisMonthIncome: roundToCents(thisMonthIncome),
      thisMonthExpenses: roundToCents(thisMonthExpenses),
      lastMonthIncome: roundToCents(lastMonthIncome),
      lastMonthExpenses: roundToCents(lastMonthExpenses),
      ytdIncome: roundToCents(ytdIncome),
      ytdExpenses: roundToCents(ytdExpenses),
      momIncomeChangePct: Math.round(momIncomeChange * 10) / 10,
      momExpensesChangePct: Math.round(momExpensesChange * 10) / 10,
    },
  };
}

// Disconnect bank connection and purge cached accounts and transactions
async function deleteEnrollment(userId, enrollmentId) {
  return await disconnectHandler.disconnectInstitution(userId, enrollmentId);
}

module.exports = {
  encryptToken: secretsVault.encryptToken,
  decryptToken: secretsVault.decryptToken,
  syncEnrollmentData: syncWorker.syncEnrollmentData,
  syncAllUserEnrollments: syncWorker.syncAllUserEnrollments,
  getConnectConfig,
  createEnrollment,
  syncUserTransactions,
  listEnrollments,
  listStoredAccounts,
  listStoredTransactions,
  getAccountsForEnrollment,
  getBalancesForAccount,
  getTransactionsForAccount,
  getNetWorth,
  getDashboardSummary,
  deleteEnrollment,
};
