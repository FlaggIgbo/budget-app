/**
 * Require auth middleware - validates session cookie and sets req.user.
 */
const db = require('../models');

const COOKIE_NAME = 'session';

module.exports = async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const session = await db.Session.findOne({
      where: { token },
      include: [{ model: db.User, attributes: ['id', 'phone'] }],
    });

    if (!session || !session.User) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    if (new Date() > session.expiresAt) {
      await session.destroy();
      return res.status(401).json({ error: 'Session expired' });
    }

    req.user = session.User;
    req.session = session;
    next();
  } catch (err) {
    next(err);
  }
};
