import db = require('../models');
import sessionService = require('../services/authentication/session.service');
import otpService = require('../services/authentication/otp.service');
import passkeyService = require('../services/authentication/passkey.service');
import passwordService = require('../services/authentication/password.service');

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
export const requestOtp = async (req, res, next) => {
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
export const verifyOtp = async (req, res, next) => {
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
export const requestSignupEmailOtp = async (req, res, next) => {
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

// POST /api/auth/signup/verify-email-otp - Verify email OTP during signup before passkey creation
export const verifySignupEmailOtp = async (req, res, next) => {
  try {
    const code = req.body?.code ?? req.body?.otp;
    const result = await otpService.verifySignupEmailOtp({
      signupToken: req.body?.signupToken,
      firstName: req.body?.firstName,
      lastName: req.body?.lastName,
      email: req.body?.email,
      code,
    });
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    return res.json({
      ok: true,
      emailVerified: true,
      phone: result.phone,
      email: result.email,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/signup/passkey/options - Generate WebAuthn navigator.credentials.create() options for signup
export const getSignupPasskeyOptions = async (req, res, next) => {
  try {
    const signupToken = req.body?.signupToken;
    const pending = await otpService.getPendingSignup(signupToken);
    const result = await passkeyService.generateSignupRegistrationOptions(
      pending,
      signupToken,
      req
    );
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    return res.json({ ok: true, options: result.options });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/signup/complete - Complete signup with passkey (or skipPasskey after error), create User, issue session
export const completeSignup = async (req, res, next) => {
  try {
    const code = req.body?.code ?? req.body?.otp;
    const result = await otpService.completeSignup({
      signupToken: req.body?.signupToken,
      firstName: req.body?.firstName,
      lastName: req.body?.lastName,
      email: req.body?.email,
      code,
      passkeyCredential: req.body?.passkeyCredential ?? req.body?.credential,
      skipPasskey: Boolean(req.body?.skipPasskey),
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

// POST /api/auth/passkey/login/options - Look up user by phone in Postgres; if passkey exists, return get() options
export const getPasskeyLoginOptions = async (req, res, next) => {
  try {
    const result = await passkeyService.generateLoginOptions(req.body?.phone, req);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    return res.json(result);
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/passkey/login/verify - Verify navigator.credentials.get() assertion and issue session
export const verifyPasskeyLogin = async (req, res, next) => {
  try {
    const result = await passkeyService.verifyLoginAssertion(req.body?.phone, req.body?.credential);
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

// TODO: POST /api/auth/login-password - Future username/email + password login stub
export const loginWithPassword = async (req, res, next) => {
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
export const setPassword = async (req, res, next) => {
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
export const logout = async (req, res, next) => {
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
export const me = async (req, res) => {
  res.json({ user: db.User.toPublicUser(req.user) });
};
