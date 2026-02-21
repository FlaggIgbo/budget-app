/**
 * Sequelize models index - initializes DB connection and exports all models.
 */
const { Sequelize } = require('sequelize');
const dbConfig = require('../config/db.config');

const sequelize = new Sequelize(dbConfig.DB, dbConfig.USER, dbConfig.PASSWORD, {
  host: dbConfig.HOST,
  port: dbConfig.PORT,
  dialect: dbConfig.dialect,
  pool: dbConfig.pool,
});

const db = {
  sequelize,
  Sequelize,
  // Models will be added here as they're created
  // User: require('./user.model')(sequelize, Sequelize),
};

module.exports = db;
