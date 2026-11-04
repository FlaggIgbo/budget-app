const db = require('../models');

// Issue a new session token for a verified email address
async function issueSession(email) {
  const [user] = await db.User.findOrCreate({
    where: { email },
    defaults: { email },
  });

  const token = db.Session.generateToken();
  await db.Session.create({
    token,
    userId: user.id,
    expiresAt: db.Session.expiresAt(),
  });

  return {
    token,
    user: { id: user.id, email: user.email },
  };
}

// Look up a session token and check if it is still valid
async function verifySessionToken(token) {
  if (!token) {
    return { error: 'Not authenticated', status: 401 };
  }

  const session = await db.Session.findOne({
    where: { token },
    include: [{ model: db.User, attributes: ['id', 'email'] }],
  });

  if (!session || !session.User) {
    return { error: 'Invalid session', status: 401 };
  }

  const now = new Date();
  if (now > session.expiresAt) {
    await session.destroy();
    return { error: 'Session expired', status: 401 };
  }

  return {
    user: session.User,
    session,
  };
}

// Delete a session token on logout
async function revokeSession(token) {
  if (token) {
    await db.Session.destroy({ where: { token } });
  }
}

module.exports = {
  issueSession,
  verifySessionToken,
  revokeSession,
};
