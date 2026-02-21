/**
 * Health check / index controller.
 * Used for API availability checks (e.g., Docker healthchecks).
 */
exports.healthCheck = (req, res) => {
  res.json({ status: 'ok', message: 'Budget App API is running' });
};
