const db = require('../models');

const COOKIE_NAME = 'session';
const SANDBOX_OTP = '123456';

// Cookie settings for browser session
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  path: '/',
};

// Check if running in sandbox or dev
function isSandboxMode() {
  const env = process.env.TELLER_ENVIRONMENT || 'sandbox';
  const nodeEnv = process.env.NODE_ENV || 'development';
  return env === 'sandbox' || nodeEnv === 'development';
}

// Remove non-digit characters from phone string
function cleanPhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return '';
  }
  return phone.replace(/\D/g, '');
}

// Send OTP code to phone number
exports.sendOtp = async (req, res, next) => {
  try {
    const rawPhone = req.body?.phone;
    const digits = cleanPhone(rawPhone);

    // 1. Phone number must have at least 10 digits
    if (digits.length < 10) {
      return res.status(400).json({ error: 'Valid US phone number required' });
    }

    // 2. In sandbox mode, no real SMS is sent
    if (isSandboxMode()) {
      return res.json({ ok: true, message: 'OTP sent (sandbox: use 123456)' });
    }

    // 3. In production, send SMS via provider
    return res.json({ ok: true, message: 'OTP sent' });
  } catch (err) {
    next(err);
  }
};

// Verify OTP code and log the user in
exports.verifyOtp = async (req, res, next) => {
  try {
    const rawPhone = req.body?.phone;
    const rawOtp = req.body?.otp;

    const digits = cleanPhone(rawPhone);
    const otp = typeof rawOtp === 'string' ? rawOtp.trim() : '';

    // 1. Validate phone number
    if (digits.length < 10) {
      return res.status(400).json({ error: 'Valid US phone number required' });
    }

    // 2. Validate OTP input
    if (!otp) {
      return res.status(400).json({ error: 'OTP required' });
    }

    // 3. Sandbox check: allow 555-555-5555 with OTP 123456
    if (isSandboxMode()) {
      const isTestPhone = digits === '1555555555' || digits === '5555555555';
      const isTestOtp = otp === SANDBOX_OTP;

      if (isTestPhone && isTestOtp) {
        // Format phone with +1 country code
        const formattedPhone = digits.startsWith('1') ? `+${digits}` : `+1${digits}`;

        // Find or create user
        const [user] = await db.User.findOrCreate({
          where: { phone: formattedPhone },
          defaults: { phone: formattedPhone },
        });

        // Create new session token
        const token = db.Session.generateToken();
        await db.Session.create({
          token,
          userId: user.id,
          expiresAt: db.Session.expiresAt(),
        });

        // Set session cookie in browser
        res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);

        return res.json({
          ok: true,
          user: { id: user.id, phone: user.phone },
        });
      }
    }

    // 4. Return error if credentials do not match
    return res.status(401).json({ error: 'Invalid OTP' });
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
