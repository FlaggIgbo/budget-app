/**
 * Teller API controller - proxy to Teller with stored access tokens.
 */
const tellerService = require('../services/teller.service');
const db = require('../models');

/**
 * Store enrollment from Teller Connect success.
 * POST /api/teller/enrollments
 * Body: { accessToken, enrollmentId, institutionName }
 */
exports.createEnrollment = async (req, res, next) => {
  try {
    const { accessToken, enrollmentId, institutionName } = req.body;
    if (!accessToken || !enrollmentId) {
      return res.status(400).json({ error: 'accessToken and enrollmentId required' });
    }

    const userId = req.user.id;
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

/**
 * List stored enrollments.
 * GET /api/teller/enrollments
 */
exports.listEnrollments = async (req, res, next) => {
  try {
    const where = { userId: req.user.id };
    const enrollments = await db.Enrollment.findAll({
      where,
      attributes: ['id', 'enrollmentId', 'institutionName', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
    res.json(enrollments);
  } catch (err) {
    next(err);
  }
};

/**
 * Get accounts for an enrollment.
 * Fetches from Teller, syncs to our DB (phone -> account info), returns accounts.
 * GET /api/teller/enrollments/:enrollmentId/accounts
 */
exports.getAccounts = async (req, res, next) => {
  try {
    const enrollment = await db.Enrollment.findOne({
      where: { enrollmentId: req.params.enrollmentId, userId: req.user.id },
    });
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    const accounts = await tellerService.getAccounts(enrollment.accessToken);
    const institutionName = enrollment.institutionName || null;

    // Sync to our DB: user (phone) -> account info
    for (const a of accounts) {
      await db.Account.upsert(
        {
          accountId: a.id,
          enrollmentId: enrollment.enrollmentId,
          userId: req.user.id,
          name: a.name,
          lastFour: a.last_four,
          type: a.type,
          subtype: a.subtype,
          institutionName: institutionName || a.institution?.name,
        },
        {
          conflictFields: ['accountId'],
        }
      );
    }

    res.json(accounts);
  } catch (err) {
    next(err);
  }
};

/**
 * Get balances for an account.
 * GET /api/teller/accounts/:accountId/balances
 * Query: enrollmentId (required)
 */
exports.getBalances = async (req, res, next) => {
  try {
    const { enrollmentId } = req.query;
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

/**
 * Get transactions for an account.
 * GET /api/teller/accounts/:accountId/transactions
 * Query: enrollmentId (required), count?, from_date?, to_date?
 */
exports.getTransactions = async (req, res, next) => {
  try {
    const { enrollmentId, count, from_date, to_date } = req.query;
    if (!enrollmentId) {
      return res.status(400).json({ error: 'enrollmentId query param required' });
    }

    const enrollment = await db.Enrollment.findOne({
      where: { enrollmentId, userId: req.user.id },
    });
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    const params = {};
    if (count) params.count = count;
    if (from_date) params.from_date = from_date;
    if (to_date) params.to_date = to_date;

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

/**
 * Get net worth overview across all linked accounts.
 * Aggregates assets (deposit: checking, savings) and liabilities (credit: credit card, line of credit).
 * GET /api/teller/net-worth
 */
exports.getNetWorth = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const enrollments = await db.Enrollment.findAll({
      where: { userId },
      attributes: ['enrollmentId', 'accessToken', 'institutionName'],
    });

    let totalAssets = 0;
    let totalLiabilities = 0;
    const accounts = [];

    for (const enrollment of enrollments) {
      const accountList = await tellerService.getAccounts(enrollment.accessToken);
      for (const a of accountList) {
        const balances = await tellerService.getBalances(enrollment.accessToken, a.id);
        const ledger = parseFloat(balances?.ledger ?? balances?.available ?? 0) || 0;
        const isAsset = (a.type || '').toLowerCase() === 'deposit';
        const isLiability = (a.type || '').toLowerCase() === 'credit';

        if (isAsset) {
          totalAssets += ledger;
        } else if (isLiability) {
          totalLiabilities += Math.abs(ledger);
        } else {
          totalAssets += Math.max(0, ledger);
          totalLiabilities += Math.max(0, -ledger);
        }

        accounts.push({
          id: a.id,
          name: a.name,
          lastFour: a.last_four,
          type: a.type,
          subtype: a.subtype,
          institutionName: enrollment.institutionName || a.institution?.name,
          balance: ledger,
          isAsset,
        });
      }
    }

    const netWorth = totalAssets - totalLiabilities;

    res.json({
      netWorth,
      totalAssets,
      totalLiabilities,
      accounts,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete an enrollment (disconnect bank).
 * Removes from Teller, deletes our DB entries (enrollment + cached accounts).
 * DELETE /api/teller/enrollments/:enrollmentId
 */
exports.deleteEnrollment = async (req, res, next) => {
  try {
    const enrollment = await db.Enrollment.findOne({
      where: { enrollmentId: req.params.enrollmentId, userId: req.user.id },
    });
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    await tellerService.deleteEnrollment(enrollment.accessToken);
    await db.Account.destroy({
      where: { enrollmentId: enrollment.enrollmentId, userId: req.user.id },
    });
    await enrollment.destroy();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
