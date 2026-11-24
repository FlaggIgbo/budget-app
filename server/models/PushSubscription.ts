import { DataTypes } from 'sequelize';

// Return public metadata only (never expose raw p256dh/auth encryption secrets back to clients)
function toPublicSubscription(sub) {
  if (!sub) {
    return null;
  }
  return {
    id: sub.id,
    endpoint: sub.endpoint,
    expirationTime:
      sub.expirationTime !== null && sub.expirationTime !== undefined
        ? Number(sub.expirationTime)
        : null,
    userAgent: sub.userAgent || null,
    lastUsedAt: sub.lastUsedAt || null,
    createdAt: sub.createdAt || null,
  };
}

export = (sequelize) => {
  // Stores durable W3C Push API PushSubscription records per user/device.
  // One user may subscribe multiple devices (e.g. mobile PWA + desktop browser).
  // Cascade-deletes automatically if the owning User is deleted, and self-heals
  // when browser push services return 404/410 Gone.
  const PushSubscription = sequelize.define(
    'PushSubscription',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      endpoint: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true,
      },
      p256dh: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      auth: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      expirationTime: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
      lastUsedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'push_subscriptions',
      underscored: true,
      indexes: [{ fields: ['endpoint'], unique: true }, { fields: ['user_id'] }],
    }
  );

  PushSubscription.toPublicSubscription = toPublicSubscription;

  return PushSubscription;
};
