const tellerService = require('../services/teller.service');
const db = require('../models');

// Save bank connection from Teller Connect
exports.createEnrollment = async (req, res, next) => {
  try {
    const accessToken = req.body?.accessToken;
    const enrollmentId = req.body?.enrollmentId;
    const institutionName = req.body?.institutionName;

    // Check required fields
    if (!accessToken || !enrollmentId) {
      return res.status(400).json({ error: 'accessToken and enrollmentId required' });
    }

    const userId = req.user.id;

    // Save or update enrollment in database
    const [enrollment] = await db.Enrollment.findOrCreate({
      where: { enrollmentId },
      defaults: { accessToken, institutionName, userId },
    });

    if (!enrollment.isNewRecord) {
      await enrollment.update({ accessToken, institutionName, userId });
    }

    res.status(201).json({
      id: enrollment.id,
      enrollmentId: enrollment.enrollmentId,
      institutionName: enrollment.institutionName,
    });
  } catch (err) {
    next(err);
  }
};

// List all connected banks for current user
exports.listEnrollments = async (req, res, next) => {
  try {
    const enrollments = await db.Enrollment.findAll({
      where: { userId: req.user.id },
      attributes: ['id', 'enrollmentId', 'institutionName', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
    res.json(enrollments);
  } catch (err) {
    next(err);
  }
};

// Get bank accounts and save to database
exports.getAccounts = async (req, res, next) => {
  try {
    const enrollment = await db.Enrollment.findOne({
      where: {
        enrollmentId: req.params.enrollmentId,
        userId: req.user.id,
      },
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    // Call Teller API to get accounts
    const accounts = await tellerService.getAccounts(enrollment.accessToken);
    const bankName = enrollment.institutionName || null;

    // Save each account into our database
    for (let i = 0; i < accounts.length; i++) {
      const a = accounts[i];
      await db.Account.upsert(
        {
          accountId: a.id,
          enrollmentId: enrollment.enrollmentId,
          userId: req.user.id,
          name: a.name,
          lastFour: a.last_four,
          type: a.type,
          subtype: a.subtype,
          institutionName: bankName || a.institution?.name,
        },
        { conflictFields: ['account_id'] }
      );
    }

    res.json(accounts);
  } catch (err) {
    next(err);
  }
};

// Get balance for a specific bank account
exports.getBalances = async (req, res, next) => {
  try {
    const enrollmentId = req.query.enrollmentId;
    if (!enrollmentId) {
      return res.status(400).json({ error: 'enrollmentId query param required' });
    }

    const enrollment = await db.Enrollment.findOne({
      where: { enrollmentId, userId: req.user.id },
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    const balances = await tellerService.getBalances(enrollment.accessToken, req.params.accountId);
    res.json(balances);
  } catch (err) {
    next(err);
  }
};

// Get transactions for a bank account
exports.getTransactions = async (req, res, next) => {
  try {
    const enrollmentId = req.query.enrollmentId;
    if (!enrollmentId) {
      return res.status(400).json({ error: 'enrollmentId query param required' });
    }

    const enrollment = await db.Enrollment.findOne({
      where: { enrollmentId, userId: req.user.id },
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    // Build filter parameters
    const params = {};
    if (req.query.count) params.count = req.query.count;
    if (req.query.from_date) params.from_date = req.query.from_date;
    if (req.query.to_date) params.to_date = req.query.to_date;

    const transactions = await tellerService.getTransactions(
      enrollment.accessToken,
      req.params.accountId,
      params
    );

    res.json(transactions);
  } catch (err) {
    next(err);
  }
};

// Calculate net worth (Total Assets minus Total Liabilities)
exports.getNetWorth = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Find all bank connections for user
    const enrollments = await db.Enrollment.findAll({
      where: { userId },
      attributes: ['enrollmentId', 'accessToken', 'institutionName'],
    });

    let totalAssets = 0;
    let totalLiabilities = 0;
    const accountList = [];

    // Loop through each connected bank
    for (let i = 0; i < enrollments.length; i++) {
      const enrollment = enrollments[i];
      const accounts = await tellerService.getAccounts(enrollment.accessToken);

      // Loop through each account in this bank
      for (let j = 0; j < accounts.length; j++) {
        const a = accounts[j];
        const balances = await tellerService.getBalances(enrollment.accessToken, a.id);

        // Get account balance number
        const rawBalance = balances?.ledger ?? balances?.available ?? 0;
        const balance = parseFloat(rawBalance) || 0;

        const accountType = (a.type || '').toLowerCase();
        const isAsset = accountType === 'deposit';
        const isLiability = accountType === 'credit';

        if (isAsset) {
          totalAssets += balance;
        } else if (isLiability) {
          totalLiabilities += Math.abs(balance);
        } else {
          // Fallback if type is not deposit or credit
          if (balance >= 0) {
            totalAssets += balance;
          } else {
            totalLiabilities += Math.abs(balance);
          }
        }

        accountList.push({
          id: a.id,
          name: a.name,
          lastFour: a.last_four,
          type: a.type,
          subtype: a.subtype,
          institutionName: enrollment.institutionName || a.institution?.name,
          balance: balance,
          isAsset: isAsset,
        });
      }
    }

    // Net worth = Assets - Liabilities
    const netWorth = totalAssets - totalLiabilities;

    res.json({
      netWorth,
      totalAssets,
      totalLiabilities,
      accounts: accountList,
    });
  } catch (err) {
    next(err);
  }
};

// Get monthly dashboard summary (income, expenses, spending by category)
exports.getDashboardSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const monthsBack = parseInt(req.query.months, 10) || 3;

    // 1. Get user enrollments
    const enrollments = await db.Enrollment.findAll({
      where: { userId },
      attributes: ['enrollmentId', 'accessToken', 'institutionName'],
    });

    const allTransactions = [];

    // Calculate start date
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const startStr = startDate.toISOString().slice(0, 10);
    const endStr = endDate.toISOString().slice(0, 10);

    // 2. Fetch transactions from all accounts
    for (let i = 0; i < enrollments.length; i++) {
      const enrollment = enrollments[i];
      const accounts = await tellerService.getAccounts(enrollment.accessToken);

      for (let j = 0; j < accounts.length; j++) {
        const a = accounts[j];
        try {
          const txns = await tellerService.getTransactions(enrollment.accessToken, a.id, {
            start_date: startStr,
            end_date: endStr,
            count: 500,
          });

          const list = Array.isArray(txns) ? txns : [];
          for (let k = 0; k < list.length; k++) {
            const t = list[k];
            allTransactions.push({
              ...t,
              account_id: t.account_id || a.id,
              accountName: a.name,
              institutionName: enrollment.institutionName,
            });
          }
        } catch {
          // If one account fails, skip it
        }
      }
    }

    // 3. Group income and expenses by month
    const incomeByMonth = {};
    const expensesByMonth = {};

    for (let i = 0; i < allTransactions.length; i++) {
      const t = allTransactions[i];
      const amount = parseFloat(t.amount) || 0;
      const month = (t.date || '').slice(0, 7); // e.g. "2026-10"

      if (!month) continue;

      if (amount > 0) {
        // Positive means income
        incomeByMonth[month] = (incomeByMonth[month] || 0) + amount;
      } else {
        // Negative means expense
        expensesByMonth[month] = (expensesByMonth[month] || 0) + Math.abs(amount);
      }
    }

    // Combine all unique months
    const allMonths = Object.keys({ ...incomeByMonth, ...expensesByMonth }).sort();
    const incomeVsExpenses = [];
    for (let i = 0; i < allMonths.length; i++) {
      const m = allMonths[i];
      incomeVsExpenses.push({
        month: m,
        income: Math.round((incomeByMonth[m] || 0) * 100) / 100,
        expenses: Math.round((expensesByMonth[m] || 0) * 100) / 100,
      });
    }

    // 4. Calculate spending by category for current month
    const currentMonth = now.toISOString().slice(0, 7);
    const categoryTotals = {};

    for (let i = 0; i < allTransactions.length; i++) {
      const t = allTransactions[i];
      const month = (t.date || '').slice(0, 7);
      if (month !== currentMonth) continue;

      const amount = parseFloat(t.amount) || 0;
      if (amount >= 0) continue; // Skip income

      const category = t.details?.category || 'Uncategorized';
      categoryTotals[category] = (categoryTotals[category] || 0) + Math.abs(amount);
    }

    const spendingByCategory = [];
    const catKeys = Object.keys(categoryTotals);
    for (let i = 0; i < catKeys.length; i++) {
      const cat = catKeys[i];
      spendingByCategory.push({
        category: cat,
        amount: Math.round(categoryTotals[cat] * 100) / 100,
      });
    }
    // Sort highest spending first
    spendingByCategory.sort((a, b) => b.amount - a.amount);

    // 5. Recent transactions (most recent 20)
    allTransactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const recentTransactions = [];
    const maxRecent = Math.min(allTransactions.length, 20);

    for (let i = 0; i < maxRecent; i++) {
      const t = allTransactions[i];
      recentTransactions.push({
        id: t.id,
        date: t.date,
        description: t.description,
        amount: parseFloat(t.amount) || 0,
        category: t.details?.category || 'Uncategorized',
        accountName: t.accountName,
        institutionName: t.institutionName || null,
      });
    }

    // 6. Quick stats (this month, last month, YTD)
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonth = lastMonthDate.toISOString().slice(0, 7);
    const thisYear = String(now.getFullYear());

    let thisMonthIncome = incomeByMonth[currentMonth] || 0;
    let thisMonthExpenses = expensesByMonth[currentMonth] || 0;
    let lastMonthIncome = incomeByMonth[lastMonth] || 0;
    let lastMonthExpenses = expensesByMonth[lastMonth] || 0;

    let ytdIncome = 0;
    let ytdExpenses = 0;
    for (let i = 0; i < allMonths.length; i++) {
      const m = allMonths[i];
      if (m.startsWith(thisYear)) {
        ytdIncome += incomeByMonth[m] || 0;
        ytdExpenses += expensesByMonth[m] || 0;
      }
    }

    // Calculate percentage changes
    let momIncomeChange = 0;
    if (lastMonthIncome > 0) {
      momIncomeChange = ((thisMonthIncome - lastMonthIncome) / lastMonthIncome) * 100;
    }

    let momExpensesChange = 0;
    if (lastMonthExpenses > 0) {
      momExpensesChange = ((thisMonthExpenses - lastMonthExpenses) / lastMonthExpenses) * 100;
    }

    res.json({
      incomeVsExpenses,
      spendingByCategory,
      recentTransactions,
      quickStats: {
        thisMonthIncome: Math.round(thisMonthIncome * 100) / 100,
        thisMonthExpenses: Math.round(thisMonthExpenses * 100) / 100,
        lastMonthIncome: Math.round(lastMonthIncome * 100) / 100,
        lastMonthExpenses: Math.round(lastMonthExpenses * 100) / 100,
        ytdIncome: Math.round(ytdIncome * 100) / 100,
        ytdExpenses: Math.round(ytdExpenses * 100) / 100,
        momIncomeChangePct: Math.round(momIncomeChange * 10) / 10,
        momExpensesChangePct: Math.round(momExpensesChange * 10) / 10,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Disconnect bank connection
exports.deleteEnrollment = async (req, res, next) => {
  try {
    const enrollment = await db.Enrollment.findOne({
      where: {
        enrollmentId: req.params.enrollmentId,
        userId: req.user.id,
      },
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    // Delete from Teller API
    await tellerService.deleteEnrollment(enrollment.accessToken);

    // Delete cached accounts and enrollment from database
    await db.Account.destroy({
      where: { enrollmentId: enrollment.enrollmentId, userId: req.user.id },
    });
    await enrollment.destroy();

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
