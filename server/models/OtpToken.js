const { DataTypes } = require('sequelize');
const crypto = require('crypto');

// Generate random 6-digit OTP code
function generateCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

// OTP expires in 5 minutes by default
function expiresAt(minutes = 5) {
  const nowMs = Date.now();
  const minutesInMs = minutes * 60 * 1000;
  return new Date(nowMs + minutesInMs);
}

module.exports = (sequelize) => {
  // OtpToken table stores temporary email verification codes
  const OtpToken = sequelize.define(
    'OtpToken',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(6),
        allowNull: false,
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
      },
    },
    {
      tableName: 'otp_tokens',
      underscored: true,
      indexes: [{ fields: ['email'] }],
    }
  );

  OtpToken.generateCode = generateCode;
  OtpToken.expiresAt = expiresAt;

  return OtpToken;
};
