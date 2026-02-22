/**
 * Global error handling middleware.
 * Catches errors from routes/controllers and returns consistent JSON responses.
 */
const errorHandler = (err, req, res, _next) => {
  console.error(err.stack);

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
