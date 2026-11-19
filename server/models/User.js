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

// Trim a user's first or last name
function normalizeName(name) {
  if (!name || typeof name !== 'string') {
    return '';
  }
  return name.trim();
}

// Validate a non-empty first or last name
function isValidName(name) {
  const normalized = normalizeName(name);
  return normalized.length >= 1 && normalized.length <= 100;
}

// Return public user fields only (never expose password hash or passkey public key material)
function toPublicUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    email: user.email,
    hasPasskey: Boolean(user.passkeyCredentialId),
    passkeyCreatedAt: user.passkeyCreatedAt || null,
  };
}

module.exports = (sequelize) => {
  // User table: phone is the primary login identifier (passkey or OTP fallback); firstName, lastName,
  // and verified email are collected at signup. Passkey WebAuthn credentials are stored directly on
  // the user record. The nullable password column is reserved for a future username/password migration.
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      firstName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      lastName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      phone: {
        type: DataTypes.STRING(32),
        allowNull: false,
        unique: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: true,
        // TODO: Store a salted password hash (e.g., argon2id or bcrypt) here when migrating
        // from phone OTP authentication to username/password login. Never store plaintext passwords.
      },
      passkeyCredentialId: {
        type: DataTypes.STRING(512),
        allowNull: true,
        unique: true,
      },
      passkeyPublicKey: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      passkeyAlgorithm: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      passkeyCounter: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      passkeyTransports: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      passkeyCreatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'users',
      underscored: true,
      indexes: [
        { fields: ['phone'], unique: true },
        { fields: ['email'], unique: true },
        { fields: ['passkey_credential_id'], unique: true },
      ],
    }
  );

  User.normalizeEmail = normalizeEmail;
  User.isValidEmail = isValidEmail;
  User.normalizePhone = normalizePhone;
  User.isValidPhone = isValidPhone;
  User.normalizeName = normalizeName;
  User.isValidName = isValidName;
  User.toPublicUser = toPublicUser;

  return User;
};
