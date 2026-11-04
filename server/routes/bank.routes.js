const controller = require('../controllers/bank.controller');
const requireAuth = require('../middleware/requireAuth');

// Bank connection, sync worker, and dashboard routes (all require login)
module.exports = (app) => {
  // Teller Connect UI configuration
  app.post('/api/bank/link-token', requireAuth, controller.createLinkToken);

  // Bank enrollment & token exchange
  app.post('/api/bank/exchange-token', requireAuth, controller.createEnrollment);
  app.post('/api/bank/enrollments', requireAuth, controller.createEnrollment);
  app.get('/api/bank/enrollments', requireAuth, controller.listEnrollments);
  app.get('/api/bank/enrollments/:enrollmentId/accounts', requireAuth, controller.getAccounts);
  app.delete('/api/bank/enrollments/:enrollmentId', requireAuth, controller.deleteEnrollment);

  // Accounts & balances
  app.get('/api/bank/accounts', requireAuth, controller.listAllAccounts);
  app.get('/api/bank/accounts/:accountId/balances', requireAuth, controller.getBalances);
  app.get('/api/bank/accounts/:accountId/transactions', requireAuth, controller.getTransactions);

  // Transactions & sync
  app.get('/api/bank/transactions', requireAuth, controller.listAllTransactions);
  app.post('/api/bank/transactions/sync', requireAuth, controller.syncTransactions);

  // Dashboard & insights
  app.get('/api/bank/net-worth', requireAuth, controller.getNetWorth);
  app.get('/api/bank/dashboard-summary', requireAuth, controller.getDashboardSummary);
};
