const { DataTypes } = require('sequelize');
const crypto = require('crypto');

// Create random session token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Session expires in 7 days
function expiresAt() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date;
}

module.exports = (sequelize) => {
  // Session table stores login tokens
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
