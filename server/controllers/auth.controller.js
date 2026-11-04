const sessionService = require('../services/session.service');
const otpService = require('../services/otp.service');

const COOKIE_NAME = 'session';

// Cookie settings for browser session
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  path: '/',
};

// POST /api/otp/request - Generate 6-digit code, store in Redis with TTL, and send via Nodemailer
exports.requestOtp = async (req, res, next) => {
  try {
    const result = await otpService.requestOtp(req.body?.email);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    return res.json({ ok: true, message: result.message });
  } catch (err) {
    next(err);
  }
};

// POST /api/otp/verify - Compare code in Redis (GET/DEL) and issue session via Session Service
exports.verifyOtp = async (req, res, next) => {
  try {
    const code = req.body?.code ?? req.body?.otp;
    const result = await otpService.verifyOtp(req.body?.email, code);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.cookie(COOKIE_NAME, result.token, COOKIE_OPTIONS);
    return res.json({
      ok: true,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
};

// Log user out and delete session
exports.logout = async (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    await sessionService.revokeSession(token);

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
