const db = require('../models');

// Check that the user is logged in
module.exports = async (req, res, next) => {
  // 1. Get session token from cookie
  const token = req.cookies?.session;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // 2. Find session in database
    const session = await db.Session.findOne({
      where: { token },
      include: [{ model: db.User, attributes: ['id', 'email'] }],
    });

    if (!session || !session.User) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    // 3. Check if session expired
    const now = new Date();
    if (now > session.expiresAt) {
      await session.destroy();
      return res.status(401).json({ error: 'Session expired' });
    }

    // 4. Attach user to request
    req.user = session.User;
    req.session = session;
    next();
  } catch (err) {
    next(err);
  }
};
