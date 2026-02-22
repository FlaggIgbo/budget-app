/**
 * Account model - caches Teller account info per user (phone).
 * Key: user (via userId) + enrollmentId + accountId.
 * Deleted when user disconnects enrollment.
 */
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Account = sequelize.define(
    'Account',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      accountId: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'account_id',
      },
      enrollmentId: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'enrollment_id',
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
        references: { model: 'users', key: 'id' },
      },
      name: {
        type: DataTypes.STRING,
      },
      lastFour: {
        type: DataTypes.STRING(4),
        field: 'last_four',
      },
      type: {
        type: DataTypes.STRING,
      },
      subtype: {
        type: DataTypes.STRING,
      },
      institutionName: {
        type: DataTypes.STRING,
        field: 'institution_name',
      },
    },
    {
      tableName: 'accounts',
      underscored: true,
      indexes: [
        { fields: ['user_id'] },
        { fields: ['enrollment_id'] },
        { fields: ['account_id'], unique: true },
      ],
    }
  );

  return Account;
};
