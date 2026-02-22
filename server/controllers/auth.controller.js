/**
 * Auth controller - phone + OTP login with sandbox bypass.
 */
const db = require('../models');
const Session = db.Session;
const User = db.User;

const COOKIE_NAME = 'session';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
};

const isSandboxMode = () =>
  process.env.TELLER_ENVIRONMENT === 'sandbox' || process.env.NODE_ENV === 'development';

const SANDBOX_OTP = '123456';

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  return phone.replace(/\D/g, '');
}

/**
 * POST /api/auth/send-otp
 * In sandbox: always succeeds (no real OTP sent).
 * In production: would integrate with Twilio/etc.
 */
exports.sendOtp = async (req, res, next) => {
  try {
    const { phone } = req.body;
    const normalized = normalizePhone(phone);
    if (!normalized || normalized.length < 10) {
      return res.status(400).json({ error: 'Valid US phone number required' });
    }

    if (isSandboxMode()) {
      return res.json({ ok: true, message: 'OTP sent (sandbox: use 123456)' });
    }

    // TODO: Integrate with SMS provider (Twilio, etc.)
    res.json({ ok: true, message: 'OTP sent' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/verify-otp
 * Verifies OTP and creates session. In sandbox: 5555555555 + 123456 always works.
 */
exports.verifyOtp = async (req, res, next) => {
  try {
    const { phone, otp } = req.body;
    const normalized = normalizePhone(phone);
    if (!normalized || normalized.length < 10) {
      return res.status(400).json({ error: 'Valid US phone number required' });
    }
    if (!otp || typeof otp !== 'string') {
      return res.status(400).json({ error: 'OTP required' });
    }

    const otpTrimmed = otp.trim();

    // Sandbox bypass: fake phone + fake OTP
    if (isSandboxMode()) {
      const isSandboxPhone = normalized === '1555555555' || normalized === '5555555555';
      const isSandboxOtp = otpTrimmed === SANDBOX_OTP;
      if (isSandboxPhone && isSandboxOtp) {
        const phoneE164 = normalized.startsWith('1') ? `+${normalized}` : `+1${normalized}`;
        const [user] = await User.findOrCreate({
          where: { phone: phoneE164 },
          defaults: { phone: phoneE164 },
        });
        const token = Session.generateToken();
        await Session.create({
          token,
          userId: user.id,
          expiresAt: Session.expiresAt(),
        });
        res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
        return res.json({ ok: true, user: { id: user.id, phone: user.phone } });
      }
    }

    // Production: validate OTP from store (TODO: implement OTP storage/validation)
    return res.status(401).json({ error: 'Invalid OTP' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/logout
 * Clears session cookie and invalidates session.
 */
exports.logout = async (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      await Session.destroy({ where: { token } });
    }
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/me
 * Returns current user from session. Requires auth middleware.
 */
exports.me = async (req, res) => {
  res.json({ user: req.user });
};
