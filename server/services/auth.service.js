const db = require('../models');
const emailService = require('./email.service');
const otpService = require('./otp.service');

const SANDBOX_EMAIL = 'test@example.com';
const SANDBOX_OTP = '123456';

// Check if running in sandbox or lower environment
function isSandboxMode() {
  const env = process.env.TELLER_ENVIRONMENT || 'sandbox';
  const nodeEnv = process.env.NODE_ENV || 'development';
  return env === 'sandbox' || nodeEnv === 'development';
}

// Normalize and validate email using the User model helpers
function normalizeEmail(rawEmail) {
  return db.User.normalizeEmail(rawEmail);
}

function isValidEmail(email) {
  return db.User.isValidEmail(email);
}

// Send OTP code to email address
async function sendOtp(rawEmail) {
  const email = normalizeEmail(rawEmail);

  if (!isValidEmail(email)) {
    return { error: 'Valid email address required', status: 400 };
  }

  // In sandbox/lower environments, use dummy credentials without sending real email
  if (isSandboxMode()) {
    return { ok: true, message: 'OTP sent (sandbox: use 123456)' };
  }

  // In production: generate 6-digit code, store in Redis with 5-minute TTL, and send via SMTP
  const code = otpService.generateCode();
  await otpService.saveOtp(email, code);
  await emailService.sendOtpEmail(email, code);

  return { ok: true, message: 'OTP sent' };
}

// Helper to find or create user and create a login session in the database
async function createSessionForEmail(email) {
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

// Verify OTP code and create a user session
async function verifyOtp(rawEmail, rawOtp) {
  const email = normalizeEmail(rawEmail);
  const otp = typeof rawOtp === 'string' ? rawOtp.trim() : '';

  if (!isValidEmail(email)) {
    return { error: 'Valid email address required', status: 400 };
  }

  if (!otp) {
    return { error: 'OTP required', status: 400 };
  }

  // Sandbox check: allow dummy email test@example.com with OTP 123456
  if (isSandboxMode()) {
    if (email === SANDBOX_EMAIL && otp === SANDBOX_OTP) {
      const sessionData = await createSessionForEmail(email);
      return { ok: true, ...sessionData };
    }
  }

  // Production / Redis check: look up OTP in Redis and delete upon match
  const storedCode = await otpService.getOtp(email);
  if (!storedCode || storedCode !== otp) {
    return { error: 'Invalid or expired OTP', status: 401 };
  }

  await otpService.deleteOtp(email);
  const sessionData = await createSessionForEmail(email);
  return { ok: true, ...sessionData };
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
async function logoutSession(token) {
  if (token) {
    await db.Session.destroy({ where: { token } });
  }
}

// Get user profile by ID
async function getUserProfile(userId) {
  const user = await db.User.findByPk(userId, {
    attributes: ['id', 'email'],
  });
  if (!user) {
    return null;
  }
  return { id: user.id, email: user.email };
}

// Update user profile by ID
async function updateUserProfile(userId, updates = {}) {
  const user = await db.User.findByPk(userId);
  if (!user) {
    return null;
  }

  if (updates.email) {
    const normalized = normalizeEmail(updates.email);
    if (isValidEmail(normalized)) {
      await user.update({ email: normalized });
    }
  }

  return { id: user.id, email: user.email };
}

module.exports = {
  isSandboxMode,
  normalizeEmail,
  isValidEmail,
  sendOtp,
  verifyOtp,
  verifySessionToken,
  logoutSession,
  getUserProfile,
  updateUserProfile,
};
