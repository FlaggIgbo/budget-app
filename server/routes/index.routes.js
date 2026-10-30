const controller = require('../controllers/index.controller');

// Health check routes
module.exports = (app) => {
  app.get('/', controller.healthCheck);
  app.get('/api', controller.healthCheck);
  app.get('/api/health', controller.healthCheck);
};
