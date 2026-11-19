const controller = require('../controllers/auth.controller');
const requireAuth = require('../middleware/requireAuth');

// Authentication, Passkey (WebAuthn), OTP sign-in, and new-user signup routes
module.exports = (app) => {
  app.post(['/api/otp/request', '/otp/request'], controller.requestOtp);
  app.post(['/api/otp/verify', '/otp/verify'], controller.verifyOtp);
  app.post('/api/auth/passkey/login/options', controller.getPasskeyLoginOptions);
  app.post('/api/auth/passkey/login/verify', controller.verifyPasskeyLogin);
  app.post('/api/auth/signup/request-email-otp', controller.requestSignupEmailOtp);
  app.post('/api/auth/signup/verify-email-otp', controller.verifySignupEmailOtp);
  app.post('/api/auth/signup/passkey/options', controller.getSignupPasskeyOptions);
  app.post('/api/auth/signup/complete', controller.completeSignup);
  app.post('/api/auth/logout', controller.logout);
  app.get('/api/auth/me', requireAuth, controller.me);

  // TODO: Username/password login & password management stubs (currently return 501)
  app.post('/api/auth/login-password', controller.loginWithPassword);
  app.post('/api/auth/password', requireAuth, controller.setPassword);
};
