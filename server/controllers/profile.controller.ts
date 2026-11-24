import db = require('../models');
import otpService = require('../services/authentication/otp.service');
import passkeyService = require('../services/authentication/passkey.service');

// Get current user profile (includes name, email, phone, and passkey status; excludes secrets)
export const getProfile = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await db.User.findByPk(req.user.id, {
      attributes: [
        'id',
        'firstName',
        'lastName',
        'email',
        'phone',
        'passkeyCredentialId',
        'passkeyCreatedAt',
      ],
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(db.User.toPublicUser(user));
  } catch (err) {
    next(err);
  }
};

// POST /api/profile/contact/request-otp -> Send OTP to verify a new email or phone number
export const requestContactOtp = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await otpService.requestContactOtp(req.user.id, {
      type: req.body?.type,
      email: req.body?.email,
      phone: req.body?.phone,
    });

    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({ ok: true, message: result.message });
  } catch (err) {
    next(err);
  }
};

// POST /api/profile/contact/verify-otp -> Verify OTP and update email or phone in user profile DB record
export const verifyContactOtp = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const code = req.body?.code ?? req.body?.otp;
    const result = await otpService.verifyContactOtp(
      req.user.id,
      {
        type: req.body?.type,
        email: req.body?.email,
        phone: req.body?.phone,
      },
      code
    );

    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({
      ok: true,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/profile/passkey/register/options -> Generate WebAuthn options to add a passkey
export const getPasskeyRegisterOptions = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await passkeyService.generateProfileRegistrationOptions(req.user.id, req);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({ ok: true, options: result.options });
  } catch (err) {
    next(err);
  }
};

// POST /api/profile/passkey/register/verify -> Verify and save passkey on the authenticated user
export const verifyPasskeyRegister = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await passkeyService.verifyProfileRegistration(
      req.user.id,
      req.body?.credential
    );
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({
      ok: true,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/profile/passkey -> Remove the authenticated user's passkey
export const deletePasskey = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await passkeyService.deleteProfilePasskey(req.user.id);
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({
      ok: true,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
};
