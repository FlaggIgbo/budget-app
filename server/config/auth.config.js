/**
 * JWT and auth configuration.
 * In production, JWT_SECRET must be set via environment variable.
 */
module.exports = {
  secret: process.env.JWT_SECRET || 'budget-app-dev-secret-change-in-production',
  expiresIn: process.env.JWT_EXPIRES_IN || '24h',
};
