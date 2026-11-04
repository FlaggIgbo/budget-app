const db = require('../models');

// Get current user profile
exports.getProfile = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await db.User.findByPk(req.user.id, {
      attributes: ['id', 'email'],
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ id: user.id, email: user.email });
  } catch (err) {
    next(err);
  }
};
