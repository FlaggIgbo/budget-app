const crypto = require('crypto');
const db = require('../models');
const bankAdapter = require('./teller.adapter');

// Round a number to 2 decimal places (cents)
function roundToCents(amount) {
  return Math.round(amount * 100) / 100;
}

// Build a 32-byte key for AES-256 encryption of bank access tokens at rest
function getEncryptionKey() {
  const rawSecret = process.env.TOKEN_ENCRYPTION_KEY || 'budget-app-default-encryption-key';
  return crypto.createHash('sha256').update(rawSecret).digest();
}

// Encrypt bank access token before saving to database
function encryptToken(plainToken) {
  if (!plainToken) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', getEncryptionKey(), iv);
  let encrypted = cipher.update(plainToken, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

// Decrypt bank access token when reading from database
function decryptToken(storedToken) {
  if (!storedToken || !storedToken.includes(':')) {
    // Fallback for plain tokens saved before encryption was added
    return storedToken;
  }

  try {
    const parts = storedToken.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return storedToken;
  }
}

// Sync accounts, balances, and recent transactions for one enrollment into PostgreSQL
async function syncEnrollmentData(enrollment, userId) {
  const accessToken = decryptToken(enrollment.accessToken);
  const accounts = await bankAdapter.getAccounts(accessToken);
  const bankName = enrollment.institutionName || null;

  // Date window for syncing transactions (last 12 months)
  const now = new Date();
  const startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = now.toISOString().slice(0, 10);

  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    let balanceValue = 0;

    // 1. Fetch balance for this account
    try {
      const balances = await bankAdapter.getBalances(accessToken, a.id);
      const rawBalance = balances?.ledger ?? balances?.available ?? 0;
      balanceValue = parseFloat(rawBalance) || 0;
    } catch {
      balanceValue = 0;
    }

    const institutionName = bankName || a.institution?.name || null;

    // 2. Save or update account in PostgreSQL
    await db.Account.upsert(
      {
        accountId: a.id,
        enrollmentId: enrollment.enrollmentId,
        userId,
        name: a.name,
        lastFour: a.last_four,
        type: a.type,
        subtype: a.subtype,
        institutionName,
        balance: balanceValue,
      },
      { conflictFields: ['account_id'] }
    );

    // 3. Fetch and persist transactions for this account
    try {
      const txns = await bankAdapter.getTransactions(accessToken, a.id, {
        start_date: startStr,
        end_date: endStr,
        count: 500,
      });

      const list = Array.isArray(txns) ? txns : [];
      for (let j = 0; j < list.length; j++) {
        const t = list[j];
        if (!t.id) continue;

        await db.Transaction.upsert(
          {
            transactionId: t.id,
            accountId: t.account_id || a.id,
            enrollmentId: enrollment.enrollmentId,
            userId,
            date: t.date || endStr,
            description: t.description || 'Transaction',
            amount: parseFloat(t.amount) || 0,
            category: t.details?.category || 'Uncategorized',
            accountName: a.name,
            institutionName,
          },
          { conflictFields: ['transaction_id'] }
        );
      }
    } catch {
      // If transactions fail for one account, continue syncing other accounts
    }
  }

  return accounts;
}

// Save bank connection and encrypt its access token at rest
async function createEnrollment(userId, { accessToken, enrollmentId, institutionName }) {
  const encryptedToken = encryptToken(accessToken);

  const [enrollment] = await db.Enrollment.findOrCreate({
    where: { enrollmentId },
    defaults: {
      accessToken: encryptedToken,
      institutionName,
      userId,
    },
  });

  if (!enrollment.isNewRecord) {
    await enrollment.update({
      accessToken: encryptedToken,
      institutionName,
      userId,
    });
  }

  // Sync accounts and transactions into the database right away
  try {
    await syncEnrollmentData(enrollment, userId);
  } catch {
    // Allow enrollment creation to succeed even if initial background sync fails
  }

  return {
    id: enrollment.id,
    enrollmentId: enrollment.enrollmentId,
    institutionName: enrollment.institutionName,
  };
}

// List all connected banks for a user
async function listEnrollments(userId) {
  return await db.Enrollment.findAll({
    where: { userId },
    attributes: ['id', 'enrollmentId', 'institutionName', 'createdAt'],
    order: [['createdAt', 'DESC']],
  });
}

// Sync and return bank accounts for a specific enrollment
async function getAccountsForEnrollment(userId, enrollmentId) {
  const enrollment = await db.Enrollment.findOne({
    where: { enrollmentId, userId },
  });

  if (!enrollment) {
    return null;
  }

  const accounts = await syncEnrollmentData(enrollment, userId);
  return accounts;
}

// Get balance for a specific bank account
async function getBalancesForAccount(userId, enrollmentId, accountId) {
  const enrollment = await db.Enrollment.findOne({
    where: { enrollmentId, userId },
  });

  if (!enrollment) {
    return null;
  }

  const accessToken = decryptToken(enrollment.accessToken);
  return await bankAdapter.getBalances(accessToken, accountId);
}

// Get transactions for a specific bank account
async function getTransactionsForAccount(userId, enrollmentId, accountId, params = {}) {
  const enrollment = await db.Enrollment.findOne({
    where: { enrollmentId, userId },
  });

  if (!enrollment) {
    return null;
  }

  const accessToken = decryptToken(enrollment.accessToken);
  return await bankAdapter.getTransactions(accessToken, accountId, params);
}

// Calculate net worth from persisted accounts in PostgreSQL (syncing first if none are cached)
async function getNetWorth(userId) {
  const enrollments = await db.Enrollment.findAll({
    where: { userId },
  });

  let storedAccounts = await db.Account.findAll({
    where: { userId },
    order: [['createdAt', 'ASC']],
  });

  // If the user has connected banks but no cached accounts yet, sync once from the provider
  if (enrollments.length > 0 && storedAccounts.length === 0) {
    for (let i = 0; i < enrollments.length; i++) {
      try {
        await syncEnrollmentData(enrollments[i], userId);
      } catch {
        // Ignore individual enrollment sync errors
      }
    }
    storedAccounts = await db.Account.findAll({
      where: { userId },
      order: [['createdAt', 'ASC']],
    });
  }

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
      id: a.accountId,
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
        await syncEnrollmentData(enrollments[i], userId);
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

  // 1. Filter transactions within the requested date window
  const allTransactions = [];
  for (let i = 0; i < storedTransactions.length; i++) {
    const t = storedTransactions[i];
    if (t.date >= startStr && t.date <= endStr) {
      allTransactions.push(t);
    }
  }

  // 2. Group income and expenses by month
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

  // 3. Calculate spending by category for current month
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

  // 4. Recent transactions (most recent 20)
  allTransactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const recentTransactions = [];
  const maxRecent = Math.min(allTransactions.length, 20);

  for (let i = 0; i < maxRecent; i++) {
    const t = allTransactions[i];
    recentTransactions.push({
      id: t.transactionId,
      date: t.date,
      description: t.description,
      amount: parseFloat(t.amount) || 0,
      category: t.category || 'Uncategorized',
      accountName: t.accountName,
      institutionName: t.institutionName || null,
    });
  }

  // 5. Quick stats (this month, last month, YTD)
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

// Disconnect bank connection and remove cached accounts and transactions
async function deleteEnrollment(userId, enrollmentId) {
  const enrollment = await db.Enrollment.findOne({
    where: { enrollmentId, userId },
  });

  if (!enrollment) {
    return false;
  }

  const accessToken = decryptToken(enrollment.accessToken);
  await bankAdapter.deleteEnrollment(accessToken);

  await db.Transaction.destroy({
    where: { enrollmentId: enrollment.enrollmentId, userId },
  });
  await db.Account.destroy({
    where: { enrollmentId: enrollment.enrollmentId, userId },
  });
  await enrollment.destroy();

  return true;
}

module.exports = {
  encryptToken,
  decryptToken,
  syncEnrollmentData,
  createEnrollment,
  listEnrollments,
  getAccountsForEnrollment,
  getBalancesForAccount,
  getTransactionsForAccount,
  getNetWorth,
  getDashboardSummary,
  deleteEnrollment,
};
