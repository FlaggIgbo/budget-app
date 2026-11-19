const controller = require('../controllers/profile.controller');
const requireAuth = require('../middleware/requireAuth');

// User profile, contact verification, and passkey management routes
module.exports = (app) => {
  app.get('/api/profile', requireAuth, controller.getProfile);
  app.post('/api/profile/contact/request-otp', requireAuth, controller.requestContactOtp);
  app.post('/api/profile/contact/verify-otp', requireAuth, controller.verifyContactOtp);
  app.post(
    '/api/profile/passkey/register/options',
    requireAuth,
    controller.getPasskeyRegisterOptions
  );
  app.post('/api/profile/passkey/register/verify', requireAuth, controller.verifyPasskeyRegister);
  app.delete('/api/profile/passkey', requireAuth, controller.deletePasskey);
};
