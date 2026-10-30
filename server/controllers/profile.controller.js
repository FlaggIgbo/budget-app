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
      phone: user.phone,
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
      attributes: ['id', 'phone'],
    });

    res.json({
      id: updated.id,
      phone: updated.phone,
    });
  } catch (err) {
    next(err);
  }
};
