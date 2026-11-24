import controller = require('../controllers/index.controller');

// Health check routes
export = (app) => {
  app.get('/', controller.healthCheck);
  app.get('/api', controller.healthCheck);
  app.get('/api/health', controller.healthCheck);
};
