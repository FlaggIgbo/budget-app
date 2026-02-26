/**
 * Teller API routes - bank integration. All require auth.
 */
const controller = require('../controllers/teller.controller');
const requireAuth = require('../middleware/requireAuth');

module.exports = (app) => {
  app.get('/api/teller/net-worth', requireAuth, controller.getNetWorth);
  app.post('/api/teller/enrollments', requireAuth, controller.createEnrollment);
  app.get('/api/teller/enrollments', requireAuth, controller.listEnrollments);
  app.get('/api/teller/enrollments/:enrollmentId/accounts', requireAuth, controller.getAccounts);
  app.get('/api/teller/accounts/:accountId/balances', requireAuth, controller.getBalances);
  app.get('/api/teller/accounts/:accountId/transactions', requireAuth, controller.getTransactions);
  app.delete('/api/teller/enrollments/:enrollmentId', requireAuth, controller.deleteEnrollment);
};
