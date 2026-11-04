const db = require('../models');

// Get current user profile
exports.getProfile = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json({
      id: user.id,
      email: user.email,
    });
  } catch (err) {
    next(err);
  }
};

// Update user profile
exports.updateProfile = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const updated = await db.User.findByPk(user.id, {
      attributes: ['id', 'email'],
    });

    res.json({
      id: updated.id,
      email: updated.email,
    });
  } catch (err) {
    next(err);
  }
};
