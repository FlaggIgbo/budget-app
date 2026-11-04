const controller = require('../controllers/profile.controller');
const requireAuth = require('../middleware/requireAuth');

// User profile routes
module.exports = (app) => {
  app.get('/api/profile', requireAuth, controller.getProfile);
};
