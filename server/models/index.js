const { Sequelize } = require('sequelize');
const dbConfig = require('../config/db.config');

// Connect to database
const isRemoteUrl =
  process.env.DATABASE_URL &&
  !process.env.DATABASE_URL.includes('localhost') &&
  !process.env.DATABASE_URL.includes('127.0.0.1');

let sequelize;
if (process.env.DATABASE_URL) {
  // Use connection string if provided
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: isRemoteUrl ? { ssl: { require: true, rejectUnauthorized: false } } : {},
    pool: dbConfig.pool,
  });
} else {
  // Use separate config values for local Postgres
  sequelize = new Sequelize(dbConfig.DB, dbConfig.USER, dbConfig.PASSWORD, {
    host: dbConfig.HOST,
    port: dbConfig.PORT,
    dialect: dbConfig.dialect,
    pool: dbConfig.pool,
  });
}

const db = {
  sequelize,
  Sequelize,
};

// Load models
db.User = require('./User')(sequelize);
db.Session = require('./Session')(sequelize);
db.Enrollment = require('./Enrollment')(sequelize);
db.Account = require('./Account')(sequelize);
db.Transaction = require('./Transaction')(sequelize);

// Link models together
db.User.hasMany(db.Session, { foreignKey: 'userId' });
db.Session.belongsTo(db.User, { foreignKey: 'userId' });

db.User.hasMany(db.Enrollment, { foreignKey: 'userId' });
db.Enrollment.belongsTo(db.User, { foreignKey: 'userId' });

db.User.hasMany(db.Account, { foreignKey: 'userId' });
db.Account.belongsTo(db.User, { foreignKey: 'userId' });

db.User.hasMany(db.Transaction, { foreignKey: 'userId' });
db.Transaction.belongsTo(db.User, { foreignKey: 'userId' });

module.exports = db;
