/**
 * Profile controller - user profile management.
 * Skeleton with TODOs for future work.
 */
const db = require('../models');

/**
 * GET /api/profile
 * Returns current user's profile.
 * TODO: Add displayName, preferences, etc. when User model is extended.
 */
exports.getProfile = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // TODO: Join with profile table when added (e.g. display_name, avatar_url, currency_preference)
    res.json({
      id: user.id,
      phone: user.phone,
      // TODO: displayName: user.displayName,
      // TODO: createdAt: user.createdAt,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/profile
 * Update current user's profile.
 * TODO: Add validation (express-validator or Joi).
 * TODO: Persist displayName, preferences when User model is extended.
 */
exports.updateProfile = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { displayName, currencyPreference } = req.body;

    // TODO: Add displayName column to users table via migration, then:
    // await db.User.update({ displayName }, { where: { id: user.id } });
    // TODO: Add user_preferences table for currency, timezone, etc.

    if (displayName !== undefined) {
      // Skeleton: accept but don't persist until User model extended
      // eslint-disable-next-line no-console
      console.warn('Profile update: displayName not persisted yet (TODO: extend User model)');
    }
    if (currencyPreference !== undefined) {
      // eslint-disable-next-line no-console
      console.warn('Profile update: currencyPreference not persisted yet (TODO: add preferences table)');
    }

    // Return current profile (no changes persisted in skeleton)
    const updated = await db.User.findByPk(user.id, { attributes: ['id', 'phone'] });
    res.json({
      id: updated.id,
      phone: updated.phone,
      // TODO: displayName: updated.displayName,
    });
  } catch (err) {
    next(err);
  }
};
