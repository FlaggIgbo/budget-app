const db = require('../models');
const otpService = require('../services/otp.service');

// Get current user profile (includes name, email, and phone; excludes password)
exports.getProfile = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await db.User.findByPk(req.user.id, {
      attributes: ['id', 'firstName', 'lastName', 'email', 'phone'],
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
exports.requestContactOtp = async (req, res, next) => {
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
exports.verifyContactOtp = async (req, res, next) => {
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
