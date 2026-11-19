const db = require('../models');
const sessionService = require('../services/session.service');
const otpService = require('../services/otp.service');
const passwordService = require('../services/password.service');

const COOKIE_NAME = 'session';

// Cookie settings for browser session (1-hour TTL matching Redis session store)
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 60 * 60 * 1000, // 1 hour in milliseconds
  path: '/',
};

// POST /api/otp/request - Generate 6-digit code, store in Redis with TTL, and send via Twilio SMS
exports.requestOtp = async (req, res, next) => {
  try {
    const result = await otpService.requestOtp(req.body?.phone);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    return res.json({ ok: true, message: result.message });
  } catch (err) {
    next(err);
  }
};

// POST /api/otp/verify - Verify phone OTP; issue session if account exists, else return signup token
exports.verifyOtp = async (req, res, next) => {
  try {
    const code = req.body?.code ?? req.body?.otp;
    const result = await otpService.verifyOtp(req.body?.phone, code);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    if (result.requiresSignup) {
      return res.json({
        ok: true,
        requiresSignup: true,
        phone: result.phone,
        signupToken: result.signupToken,
      });
    }

    res.cookie(COOKIE_NAME, result.token, COOKIE_OPTIONS);
    return res.json({
      ok: true,
      requiresSignup: false,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/signup/request-email-otp - Send 6-digit email OTP to verify email ownership during signup
exports.requestSignupEmailOtp = async (req, res, next) => {
  try {
    const result = await otpService.requestSignupEmailOtp(req.body?.signupToken, req.body?.email);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    return res.json({ ok: true, message: result.message });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/signup/complete - Verify email OTP, create User record in DB, and issue session
exports.completeSignup = async (req, res, next) => {
  try {
    const code = req.body?.code ?? req.body?.otp;
    const result = await otpService.completeSignup({
      signupToken: req.body?.signupToken,
      firstName: req.body?.firstName,
      lastName: req.body?.lastName,
      email: req.body?.email,
      code,
    });

    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.cookie(COOKIE_NAME, result.token, COOKIE_OPTIONS);
    return res.status(201).json({
      ok: true,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
};

// TODO: POST /api/auth/login-password - Future username/email + password login stub
exports.loginWithPassword = async (req, res, next) => {
  try {
    const identifier = req.body?.username ?? req.body?.email;
    const result = await passwordService.loginWithPassword(identifier, req.body?.password);
    return res.status(result.status || 501).json({
      todo: Boolean(result.todo),
      error: result.error,
    });
  } catch (err) {
    next(err);
  }
};

// TODO: POST /api/auth/password - Future endpoint for logged-in user to set/update password
exports.setPassword = async (req, res, next) => {
  try {
    const result = await passwordService.setUserPassword(req.user?.id, req.body?.password);
    return res.status(result.status || 501).json({
      todo: Boolean(result.todo),
      error: result.error,
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

// Return currently logged-in user (never exposes password column)
exports.me = async (req, res) => {
  res.json({ user: db.User.toPublicUser(req.user) });
};
