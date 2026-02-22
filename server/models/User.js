/**
 * User model - phone number as unique identifier.
 * Used for OTP-based login flow.
 */
const { DataTypes } = require('sequelize');

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  return phone.replace(/\D/g, '');
}

module.exports = (sequelize) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      phone: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true,
      },
    },
    {
      tableName: 'users',
      underscored: true,
      indexes: [{ fields: ['phone'], unique: true }],
    }
  );

  User.normalizePhone = normalizePhone;
  User.isSandboxPhone = (phone) => {
    const normalized = normalizePhone(phone);
    return normalized === '1555555555' || normalized === '5555555555';
  };

  return User;
};
