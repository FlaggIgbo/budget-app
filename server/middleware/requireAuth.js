const authService = require('../services/auth.service');

// Check that the user is logged in by delegating session lookup to authService
module.exports = async (req, res, next) => {
  const token = req.cookies?.session;

  try {
    const result = await authService.verifySessionToken(token);
    if (result.error) {
      return res.status(result.status || 401).json({ error: result.error });
    }

    req.user = result.user;
    req.session = result.session;
    next();
  } catch (err) {
    next(err);
  }
};
