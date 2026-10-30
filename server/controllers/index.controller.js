// Health check to see if the server is running
exports.healthCheck = (req, res) => {
  res.json({ status: 'ok', message: 'Budget App API is running' });
};
