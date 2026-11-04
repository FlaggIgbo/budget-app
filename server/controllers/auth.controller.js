const authService = require('../services/auth.service');

const COOKIE_NAME = 'session';

// Cookie settings for browser session
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  path: '/',
};

// Send OTP code to email address
exports.sendOtp = async (req, res, next) => {
  try {
    const result = await authService.sendOtp(req.body?.email);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    return res.json({ ok: true, message: result.message });
  } catch (err) {
    next(err);
  }
};

// Verify OTP code and log the user in
exports.verifyOtp = async (req, res, next) => {
  try {
    const result = await authService.verifyOtp(req.body?.email, req.body?.otp);
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
    await authService.logoutSession(token);

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
