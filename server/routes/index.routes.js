/**
 * Root API routes - health check and base endpoints.
 */
const controller = require('../controllers/index.controller');

module.exports = (app) => {
  app.get('/api', controller.healthCheck);
  app.get('/api/health', controller.healthCheck);
};
