const controller = require('../controllers/auth.controller');
const requireAuth = require('../middleware/requireAuth');

// Authentication and OTP passwordless sign-in routes
module.exports = (app) => {
  app.post(['/api/otp/request', '/otp/request'], controller.requestOtp);
  app.post(['/api/otp/verify', '/otp/verify'], controller.verifyOtp);
  app.post('/api/auth/logout', controller.logout);
  app.get('/api/auth/me', requireAuth, controller.me);
};
