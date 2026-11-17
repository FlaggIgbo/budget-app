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

// Normalize phone number to E.164 format (e.g. "+15551234567")
function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return '';
  }

  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  if (hasPlus) {
    return `+${digits}`;
  }

  // Default 10-digit US numbers to +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  return `+${digits}`;
}

// Validate E.164 phone number (+ followed by 7 to 15 digits)
function isValidPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return false;
  }
  return /^\+[1-9]\d{6,14}$/.test(normalized);
}

module.exports = (sequelize) => {
  // User table: phone is the primary login identifier; email is optional on the profile
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      phone: {
        type: DataTypes.STRING(32),
        allowNull: false,
        unique: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
        unique: true,
      },
    },
    {
      tableName: 'users',
      underscored: true,
      indexes: [
        { fields: ['phone'], unique: true },
        { fields: ['email'], unique: true },
      ],
    }
  );

  User.normalizeEmail = normalizeEmail;
  User.isValidEmail = isValidEmail;
  User.normalizePhone = normalizePhone;
  User.isValidPhone = isValidPhone;

  return User;
};
