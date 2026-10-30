const controller = require('../controllers/teller.controller');
const requireAuth = require('../middleware/requireAuth');

// Bank integration routes (all require login)
module.exports = (app) => {
  app.get('/api/teller/net-worth', requireAuth, controller.getNetWorth);
  app.get('/api/teller/dashboard-summary', requireAuth, controller.getDashboardSummary);
  app.post('/api/teller/enrollments', requireAuth, controller.createEnrollment);
  app.get('/api/teller/enrollments', requireAuth, controller.listEnrollments);
  app.get('/api/teller/enrollments/:enrollmentId/accounts', requireAuth, controller.getAccounts);
  app.get('/api/teller/accounts/:accountId/balances', requireAuth, controller.getBalances);
  app.get('/api/teller/accounts/:accountId/transactions', requireAuth, controller.getTransactions);
  app.delete('/api/teller/enrollments/:enrollmentId', requireAuth, controller.deleteEnrollment);
};
