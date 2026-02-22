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

    const [enrollment] = await db.Enrollment.findOrCreate({
      where: { enrollmentId },
      defaults: { accessToken, institutionName, userId: null },
    });

    if (!enrollment.isNewRecord) {
      await enrollment.update({ accessToken, institutionName });
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
    const enrollments = await db.Enrollment.findAll({
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
 * GET /api/teller/enrollments/:enrollmentId/accounts
 */
exports.getAccounts = async (req, res, next) => {
  try {
    const enrollment = await db.Enrollment.findOne({
      where: { enrollmentId: req.params.enrollmentId },
    });
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    const accounts = await tellerService.getAccounts(enrollment.accessToken);
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

    const enrollment = await db.Enrollment.findOne({ where: { enrollmentId } });
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

    const enrollment = await db.Enrollment.findOne({ where: { enrollmentId } });
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
 * Delete an enrollment (disconnect bank).
 * DELETE /api/teller/enrollments/:enrollmentId
 */
exports.deleteEnrollment = async (req, res, next) => {
  try {
    const enrollment = await db.Enrollment.findOne({
      where: { enrollmentId: req.params.enrollmentId },
    });
    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    await tellerService.deleteEnrollment(enrollment.accessToken);
    await enrollment.destroy();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};
