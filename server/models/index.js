/**
 * Sequelize models index - initializes DB connection and exports all models.
 * Supports DATABASE_URL (Neon, Supabase) or individual vars (local Docker).
 */
const { Sequelize } = require('sequelize');
const dbConfig = require('../config/db.config');

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
      pool: dbConfig.pool,
    })
  : new Sequelize(dbConfig.DB, dbConfig.USER, dbConfig.PASSWORD, {
      host: dbConfig.HOST,
      port: dbConfig.PORT,
      dialect: dbConfig.dialect,
      pool: dbConfig.pool,
    });

const db = {
  sequelize,
  Sequelize,
};

// Register models
const User = require('./User')(sequelize);
const Session = require('./Session')(sequelize);
const Enrollment = require('./Enrollment')(sequelize);
const Account = require('./Account')(sequelize);

db.User = User;
db.Session = Session;
db.Enrollment = Enrollment;
db.Account = Account;

// Associations: User (phone) -> Enrollments, Accounts
User.hasMany(Session, { foreignKey: 'userId' });
Session.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Enrollment, { foreignKey: 'userId' });
Enrollment.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Account, { foreignKey: 'userId' });
Account.belongsTo(User, { foreignKey: 'userId' });

module.exports = db;
