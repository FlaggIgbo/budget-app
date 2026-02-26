/**
 * Profile routes - user profile management. Requires auth.
 */
const controller = require('../controllers/profile.controller');
const requireAuth = require('../middleware/requireAuth');

module.exports = (app) => {
  app.get('/api/profile', requireAuth, controller.getProfile);
  app.patch('/api/profile', requireAuth, controller.updateProfile);
};
