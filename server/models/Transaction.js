const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  // Transaction table stores synced bank transactions so we don't hit the bank API on every page load
  const Transaction = sequelize.define(
    'Transaction',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      transactionId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        field: 'transaction_id',
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
      date: {
        type: DataTypes.STRING(10),
        allowNull: false,
      },
      description: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      category: {
        type: DataTypes.STRING,
        defaultValue: 'Uncategorized',
      },
      accountName: {
        type: DataTypes.STRING,
        field: 'account_name',
      },
      institutionName: {
        type: DataTypes.STRING,
        field: 'institution_name',
      },
    },
    {
      tableName: 'transactions',
      underscored: true,
      indexes: [
        { fields: ['user_id'] },
        { fields: ['account_id'] },
        { fields: ['enrollment_id'] },
        { fields: ['date'] },
        { fields: ['transaction_id'], unique: true },
      ],
    }
  );

  return Transaction;
};
