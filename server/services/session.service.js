const db = require('../models');

// Issue a new session token for a verified phone number
async function issueSession(phoneInput) {
  const phone = typeof phoneInput === 'string' ? phoneInput : phoneInput?.phone;
  if (!phone) {
    throw new Error('Phone number is required to issue a session');
  }

  const [user] = await db.User.findOrCreate({
    where: { phone },
    defaults: { phone },
  });

  const token = db.Session.generateToken();
  await db.Session.create({
    token,
    userId: user.id,
    expiresAt: db.Session.expiresAt(),
  });

  return {
    token,
    user: {
      id: user.id,
      phone: user.phone,
      email: user.email || null,
    },
  };
}

// Look up a session token and check if it is still valid
async function verifySessionToken(token) {
  if (!token) {
    return { error: 'Not authenticated', status: 401 };
  }

  const session = await db.Session.findOne({
    where: { token },
    include: [{ model: db.User, attributes: ['id', 'phone', 'email'] }],
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
