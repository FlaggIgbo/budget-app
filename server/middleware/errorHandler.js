const sentryService = require('../services/sentry.service');

// Catch any errors, report to Sentry stub, and send error response
const errorHandler = (err, req, res, _next) => {
  sentryService.captureException(err, {
    path: req?.path,
    method: req?.method,
    userId: req?.user?.id || null,
  });

  console.error(err.message || err);

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
  });
};

module.exports = errorHandler;
