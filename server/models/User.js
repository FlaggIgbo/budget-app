const { DataTypes } = require('sequelize');

// Trim and lowercase email address
function normalizeEmail(email) {
  if (!email || typeof email !== 'string') {
    return '';
  }
  return email.trim().toLowerCase();
}

// Basic email format validation (checks for "name@domain.com" structure)
function isValidEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.includes(' ')) {
    return false;
  }

  const parts = normalized.split('@');
  if (parts.length !== 2) {
    return false;
  }

  const localPart = parts[0];
  const domainPart = parts[1];
  if (!localPart || !domainPart) {
    return false;
  }

  if (!domainPart.includes('.') || domainPart.startsWith('.') || domainPart.endsWith('.')) {
    return false;
  }

  return true;
}

module.exports = (sequelize) => {
  // User table stores email addresses
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
    },
    {
      tableName: 'users',
      underscored: true,
      indexes: [{ fields: ['email'], unique: true }],
    }
  );

  User.normalizeEmail = normalizeEmail;
  User.isValidEmail = isValidEmail;

  return User;
};
