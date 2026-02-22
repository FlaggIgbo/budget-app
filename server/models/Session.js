/**
 * Session model - stores login sessions for cookie-based auth.
 */
const { DataTypes } = require('sequelize');
const crypto = require('crypto');

const SESSION_DAYS = 7;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function expiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_DAYS);
  return d;
}

module.exports = (sequelize) => {
  const Session = sequelize.define(
    'Session',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      token: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: { model: 'users', key: 'id' },
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
      },
    },
    {
      tableName: 'sessions',
      underscored: true,
      indexes: [{ fields: ['token'] }, { fields: ['user_id'] }],
    }
  );

  Session.generateToken = generateToken;
  Session.expiresAt = expiresAt;

  return Session;
};
