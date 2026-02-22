/**
 * Auth routes - phone + OTP login.
 */
const controller = require('../controllers/auth.controller');
const requireAuth = require('../middleware/requireAuth');

module.exports = (app) => {
  app.post('/api/auth/send-otp', controller.sendOtp);
  app.post('/api/auth/verify-otp', controller.verifyOtp);
  app.post('/api/auth/logout', controller.logout);
  app.get('/api/auth/me', requireAuth, controller.me);
};
