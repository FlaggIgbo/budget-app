import { Sequelize, Dialect } from 'sequelize';
import dbConfig = require('../config/db.config');
import defineUser = require('./User');
import defineEnrollment = require('./Enrollment');
import defineAccount = require('./Account');
import defineTransaction = require('./Transaction');
import definePushSubscription = require('./PushSubscription');

// Connect to database
const isRemoteUrl =
  process.env.DATABASE_URL &&
  !process.env.DATABASE_URL.includes('localhost') &&
  !process.env.DATABASE_URL.includes('127.0.0.1');

let sequelize: Sequelize;
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
    port: Number(dbConfig.PORT),
    dialect: dbConfig.dialect as Dialect,
    pool: dbConfig.pool,
  });
}

// Models are built with sequelize.define() and carry custom static helpers
// (e.g. User.normalizePhone, User.toPublicUser), so they are typed loosely.
type AnyModel = any;

interface Db {
  sequelize: Sequelize;
  Sequelize: typeof Sequelize;
  User: AnyModel;
  Enrollment: AnyModel;
  Account: AnyModel;
  Transaction: AnyModel;
  PushSubscription: AnyModel;
}

// Load models (auth sessions are stored in Redis with a 1-hour TTL)
const db: Db = {
  sequelize,
  Sequelize,
  User: defineUser(sequelize),
  Enrollment: defineEnrollment(sequelize),
  Account: defineAccount(sequelize),
  Transaction: defineTransaction(sequelize),
  PushSubscription: definePushSubscription(sequelize),
};

// Link models together with cascade delete on disconnect
db.User.hasMany(db.Enrollment, { foreignKey: 'userId', onDelete: 'CASCADE' });
db.Enrollment.belongsTo(db.User, { foreignKey: 'userId' });

db.User.hasMany(db.Account, { foreignKey: 'userId', onDelete: 'CASCADE' });
db.Account.belongsTo(db.User, { foreignKey: 'userId' });

db.User.hasMany(db.Transaction, { foreignKey: 'userId', onDelete: 'CASCADE' });
db.Transaction.belongsTo(db.User, { foreignKey: 'userId' });

db.User.hasMany(db.PushSubscription, { foreignKey: 'userId', onDelete: 'CASCADE' });
db.PushSubscription.belongsTo(db.User, { foreignKey: 'userId' });

db.Enrollment.hasMany(db.Account, {
  foreignKey: 'enrollmentId',
  sourceKey: 'enrollmentId',
  onDelete: 'CASCADE',
});
db.Account.belongsTo(db.Enrollment, {
  foreignKey: 'enrollmentId',
  targetKey: 'enrollmentId',
});

db.Enrollment.hasMany(db.Transaction, {
  foreignKey: 'enrollmentId',
  sourceKey: 'enrollmentId',
  onDelete: 'CASCADE',
});
db.Transaction.belongsTo(db.Enrollment, {
  foreignKey: 'enrollmentId',
  targetKey: 'enrollmentId',
});

export = db;
