const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  // Enrollment table stores connected bank credentials from Teller
  const Enrollment = sequelize.define(
    'Enrollment',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      enrollmentId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        field: 'enrollment_id',
      },
      accessToken: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'access_token',
      },
      institutionName: {
        type: DataTypes.STRING,
        field: 'institution_name',
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'user_id',
        references: { model: 'users', key: 'id' },
      },
    },
    {
      tableName: 'enrollments',
      underscored: true,
      indexes: [{ fields: ['enrollment_id'] }, { fields: ['user_id'] }],
    }
  );

  return Enrollment;
};
