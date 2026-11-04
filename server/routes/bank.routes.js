const controller = require('../controllers/bank.controller');
const requireAuth = require('../middleware/requireAuth');

// Bank connection and insights routes (all require login)
module.exports = (app) => {
  const prefixes = ['/api/bank', '/api/teller'];

  for (let i = 0; i < prefixes.length; i++) {
    const prefix = prefixes[i];
    app.get(`${prefix}/net-worth`, requireAuth, controller.getNetWorth);
    app.get(`${prefix}/dashboard-summary`, requireAuth, controller.getDashboardSummary);
    app.post(`${prefix}/enrollments`, requireAuth, controller.createEnrollment);
    app.get(`${prefix}/enrollments`, requireAuth, controller.listEnrollments);
    app.get(`${prefix}/enrollments/:enrollmentId/accounts`, requireAuth, controller.getAccounts);
    app.get(`${prefix}/accounts/:accountId/balances`, requireAuth, controller.getBalances);
    app.get(`${prefix}/accounts/:accountId/transactions`, requireAuth, controller.getTransactions);
    app.delete(`${prefix}/enrollments/:enrollmentId`, requireAuth, controller.deleteEnrollment);
  }
};
