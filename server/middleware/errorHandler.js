// Catch any errors and send error message
const errorHandler = (err, req, res, _next) => {
  console.error(err.message || err);

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
  });
};

module.exports = errorHandler;
