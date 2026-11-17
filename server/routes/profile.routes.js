const controller = require('../controllers/profile.controller');
const requireAuth = require('../middleware/requireAuth');

// User profile and contact verification routes
module.exports = (app) => {
  app.get('/api/profile', requireAuth, controller.getProfile);
  app.post('/api/profile/contact/request-otp', requireAuth, controller.requestContactOtp);
  app.post('/api/profile/contact/verify-otp', requireAuth, controller.verifyContactOtp);
};
