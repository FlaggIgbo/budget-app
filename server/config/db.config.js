/**
 * Database configuration for Sequelize + PostgreSQL.
 * Uses environment variables for flexibility (Docker, different environments).
 */
module.exports = {
  HOST: process.env.DB_HOST || 'localhost',
  PORT: process.env.DB_PORT || 5432,
  USER: process.env.DB_USER || 'postgres',
  PASSWORD: process.env.DB_PASSWORD || 'postgres',
  DB: process.env.DB_NAME || 'budget_app',
  dialect: 'postgres',
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
};
