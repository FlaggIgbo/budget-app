const bankService = require('../services/bank.service');

// ============================================================================
// BANK CONTROLLER (API SERVER ENDPOINTS)
// Handles requests from Browser (Teller Connect UI & Finance Dashboard)
// ============================================================================

// POST /link-token -> Return Teller Connect UI configuration
exports.createLinkToken = async (req, res, next) => {
  try {
    const config = bankService.getConnectConfig();
    res.json(config);
  } catch (err) {
    next(err);
  }
};

// POST /exchange-token and POST /enrollments -> Save encrypted access_token & sync
exports.createEnrollment = async (req, res, next) => {
  try {
    const accessToken = req.body?.accessToken || req.body?.public_token;
    const enrollmentId = req.body?.enrollmentId || req.body?.enrollment?.id;
    const institutionName =
      req.body?.institutionName || req.body?.enrollment?.institution?.name || null;

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

// GET /enrollments -> List all connected bank institutions for current user
exports.listEnrollments = async (req, res, next) => {
  try {
    const enrollments = await bankService.listEnrollments(req.user.id);
    res.json(enrollments);
  } catch (err) {
    next(err);
  }
};

// GET /accounts -> Get all persisted accounts + balances from App Database
exports.listAllAccounts = async (req, res, next) => {
  try {
    const enrollmentId = req.query.enrollmentId || null;
    const accounts = await bankService.listStoredAccounts(req.user.id, enrollmentId);
    res.json(accounts);
  } catch (err) {
    next(err);
  }
};

// GET /transactions -> Get persisted transactions (supports per-institution filtering)
exports.listAllTransactions = async (req, res, next) => {
  try {
    const filters = {
      enrollmentId: req.query.enrollmentId,
      institutionName: req.query.institutionName,
      accountId: req.query.accountId,
      count: req.query.count,
    };
    const transactions = await bankService.listStoredTransactions(req.user.id, filters);
    res.json(transactions);
  } catch (err) {
    next(err);
  }
};

// POST /transactions/sync -> Trigger Sync Worker (balances + transactions with cursor)
exports.syncTransactions = async (req, res, next) => {
  try {
    const enrollmentId = req.body?.enrollmentId || req.query?.enrollmentId || null;
    const synced = await bankService.syncUserTransactions(req.user.id, enrollmentId);
    if (synced === null) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }
    res.json({ synced });
  } catch (err) {
    next(err);
  }
};

// GET /enrollments/:enrollmentId/accounts -> Sync and return accounts for an enrollment
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

// GET /accounts/:accountId/balances -> Get balance for a specific bank account
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

// GET /accounts/:accountId/transactions -> Get transactions for a bank account from Teller
exports.getTransactions = async (req, res, next) => {
  try {
    const enrollmentId = req.query.enrollmentId;
    if (!enrollmentId) {
      return res.status(400).json({ error: 'enrollmentId query param required' });
    }

    const params = {};
    if (req.query.count) params.count = req.query.count;
    if (req.query.from_id) params.from_id = req.query.from_id;
    if (req.query.start_date) params.start_date = req.query.start_date;
    if (req.query.end_date) params.end_date = req.query.end_date;
    if (req.query.from_date) params.start_date = req.query.from_date;
    if (req.query.to_date) params.end_date = req.query.to_date;

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

// GET /net-worth -> Calculate net worth (Total Assets minus Total Liabilities)
exports.getNetWorth = async (req, res, next) => {
  try {
    const result = await bankService.getNetWorth(req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// GET /dashboard-summary -> Get monthly dashboard summary (income, expenses, spending by category)
exports.getDashboardSummary = async (req, res, next) => {
  try {
    const monthsBack = parseInt(req.query.months, 10) || 3;
    const summary = await bankService.getDashboardSummary(req.user.id, monthsBack);
    res.json(summary);
  } catch (err) {
    next(err);
  }
};

// DELETE /enrollments/:enrollmentId and POST /item/remove -> Disconnect Handler
exports.deleteEnrollment = async (req, res, next) => {
  try {
    const enrollmentId = req.params.enrollmentId || req.body?.enrollmentId;
    if (!enrollmentId) {
      return res.status(400).json({ error: 'enrollmentId required' });
    }

    const deleted = await bankService.deleteEnrollment(req.user.id, enrollmentId);
    if (!deleted) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
