const db = require('../models');
const emailService = require('../services/email.service');
const otpService = require('../services/otp.service');

const COOKIE_NAME = 'session';
const SANDBOX_EMAIL = 'test@example.com';
const SANDBOX_OTP = '123456';

// Cookie settings for browser session
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  path: '/',
};

// Check if running in sandbox or lower environment
function isSandboxMode() {
  const env = process.env.TELLER_ENVIRONMENT || 'sandbox';
  const nodeEnv = process.env.NODE_ENV || 'development';
  return env === 'sandbox' || nodeEnv === 'development';
}

// Find or create user, create session, and set cookie
async function loginUserWithEmail(email, res) {
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

  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);

  return res.json({
    ok: true,
    user: { id: user.id, email: user.email },
  });
}

// Send OTP code to email address
exports.sendOtp = async (req, res, next) => {
  try {
    const email = db.User.normalizeEmail(req.body?.email);

    // 1. Validate email address
    if (!db.User.isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email address required' });
    }

    // 2. In sandbox/lower environments, use dummy credentials without sending real email
    if (isSandboxMode()) {
      return res.json({ ok: true, message: 'OTP sent (sandbox: use 123456)' });
    }

    // 3. In production: generate 6-digit code, store in Redis with 5-minute TTL, and send via SMTP
    const code = otpService.generateCode();
    await otpService.saveOtp(email, code);
    await emailService.sendOtpEmail(email, code);

    return res.json({ ok: true, message: 'OTP sent' });
  } catch (err) {
    next(err);
  }
};

// Verify OTP code and log the user in
exports.verifyOtp = async (req, res, next) => {
  try {
    const email = db.User.normalizeEmail(req.body?.email);
    const rawOtp = req.body?.otp;
    const otp = typeof rawOtp === 'string' ? rawOtp.trim() : '';

    // 1. Validate email address
    if (!db.User.isValidEmail(email)) {
      return res.status(400).json({ error: 'Valid email address required' });
    }

    // 2. Validate OTP input
    if (!otp) {
      return res.status(400).json({ error: 'OTP required' });
    }

    // 3. Sandbox check: allow dummy email test@example.com with OTP 123456
    if (isSandboxMode()) {
      const isTestEmail = email === SANDBOX_EMAIL;
      const isTestOtp = otp === SANDBOX_OTP;

      if (isTestEmail && isTestOtp) {
        return await loginUserWithEmail(email, res);
      }
    }

    // 4. Production / Redis check: look up OTP in Redis and delete upon match
    const storedCode = await otpService.getOtp(email);
    if (!storedCode || storedCode !== otp) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    await otpService.deleteOtp(email);

    return await loginUserWithEmail(email, res);
  } catch (err) {
    next(err);
  }
};

// Log user out and delete session
exports.logout = async (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      await db.Session.destroy({ where: { token } });
    }

    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// Return currently logged-in user
exports.me = async (req, res) => {
  res.json({ user: req.user });
};
