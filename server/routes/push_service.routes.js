const controller = require('../controllers/push_service.controller');
const requireAuth = require('../middleware/requireAuth');

// Web Push API subscription management (PostgreSQL) & test notification dispatch (RabbitMQ)
module.exports = (app) => {
  app.get('/api/push/vapid-public-key', controller.getVapidPublicKey);
  app.get('/api/push/subscriptions', requireAuth, controller.listSubscriptions);
  app.post('/api/push/subscribe', requireAuth, controller.subscribe);
  app.delete('/api/push/subscribe', requireAuth, controller.unsubscribe);
  app.post('/api/push/unsubscribe', requireAuth, controller.unsubscribe);
  app.post('/api/push/test', requireAuth, controller.sendTestNotification);
};
