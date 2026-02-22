/**
 * Teller API routes - bank integration.
 */
const controller = require('../controllers/teller.controller');

module.exports = (app) => {
  app.post('/api/teller/enrollments', controller.createEnrollment);
  app.get('/api/teller/enrollments', controller.listEnrollments);
  app.get('/api/teller/enrollments/:enrollmentId/accounts', controller.getAccounts);
  app.get('/api/teller/accounts/:accountId/balances', controller.getBalances);
  app.get('/api/teller/accounts/:accountId/transactions', controller.getTransactions);
  app.delete('/api/teller/enrollments/:enrollmentId', controller.deleteEnrollment);
};
