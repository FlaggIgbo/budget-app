const bankService = require('../services/bank.service');

// Save bank connection
exports.createEnrollment = async (req, res, next) => {
  try {
    const accessToken = req.body?.accessToken;
    const enrollmentId = req.body?.enrollmentId;
    const institutionName = req.body?.institutionName;

    if (!accessToken || !enrollmentId) {
      return res.status(400).json({ error: 'accessToken and enrollmentId required' });
    }

    const enrollment = await bankService.createEnrollment(req.user.id, {
      accessToken,
      enrollmentId,
      institutionName,
    });

    res.status(201).json(enrollment);
  } catch (err) {
    next(err);
  }
};

// List all connected banks for current user
exports.listEnrollments = async (req, res, next) => {
  try {
    const enrollments = await bankService.listEnrollments(req.user.id);
    res.json(enrollments);
  } catch (err) {
    next(err);
  }
};

// Get bank accounts for an enrollment
exports.getAccounts = async (req, res, next) => {
  try {
    const accounts = await bankService.getAccountsForEnrollment(
      req.user.id,
      req.params.enrollmentId
    );

    if (!accounts) {
      return res.status(404).json({ error: 'Enrollment not found' });
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

    const balances = await bankService.getBalancesForAccount(
      req.user.id,
      enrollmentId,
      req.params.accountId
    );

    if (!balances) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

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

    const params = {};
    if (req.query.count) params.count = req.query.count;
    if (req.query.from_date) params.from_date = req.query.from_date;
    if (req.query.to_date) params.to_date = req.query.to_date;

    const transactions = await bankService.getTransactionsForAccount(
      req.user.id,
      enrollmentId,
      req.params.accountId,
      params
    );

    if (!transactions) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    res.json(transactions);
  } catch (err) {
    next(err);
  }
};

// Calculate net worth (Total Assets minus Total Liabilities)
exports.getNetWorth = async (req, res, next) => {
  try {
    const result = await bankService.getNetWorth(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// Get monthly dashboard summary (income, expenses, spending by category)
exports.getDashboardSummary = async (req, res, next) => {
  try {
    const monthsBack = parseInt(req.query.months, 10) || 3;
    const summary = await bankService.getDashboardSummary(req.user.id, monthsBack);
    res.json(summary);
  } catch (err) {
    next(err);
  }
};

// Disconnect bank connection
exports.deleteEnrollment = async (req, res, next) => {
  try {
    const deleted = await bankService.deleteEnrollment(req.user.id, req.params.enrollmentId);
    if (!deleted) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
