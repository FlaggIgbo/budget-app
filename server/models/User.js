const { DataTypes } = require('sequelize');

// Keep only digits in phone number
function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }
  return phone.replace(/\D/g, '');
}

module.exports = (sequelize) => {
  // User table stores phone numbers
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

  // Check if phone is test phone
  User.isSandboxPhone = (phone) => {
    const cleanPhone = normalizePhone(phone);
    return cleanPhone === '1555555555' || cleanPhone === '5555555555';
  };

  return User;
};
