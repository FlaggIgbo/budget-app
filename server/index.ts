import { DataTypes } from 'sequelize';
import app = require('./app');
import db = require('./models');
import sandboxModule = require('./seed/sandbox');
const { seedSandboxUser } = sandboxModule;
import eventBus = require('./services/events/eventBus.service');
import queueService = require('./services/jobs/queue.service');
import pushServiceModule = require('./push_service');
const { pushQueue } = pushServiceModule;

// Ensure existing users tables gain passkey columns cleanly without destructive sync
async function ensurePasskeyColumns() {
  const queryInterface = db.sequelize.getQueryInterface();
  const tableDesc = await queryInterface.describeTable('users');

  const columnsToAdd = [
    {
      name: 'passkey_credential_id',
      definition: { type: DataTypes.STRING(512), allowNull: true, unique: true },
    },
    {
      name: 'passkey_public_key',
      definition: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      name: 'passkey_algorithm',
      definition: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      name: 'passkey_counter',
      definition: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      name: 'passkey_transports',
      definition: { type: DataTypes.JSONB, allowNull: true },
    },
    {
      name: 'passkey_created_at',
      definition: { type: DataTypes.DATE, allowNull: true },
    },
  ];

  for (const col of columnsToAdd) {
    if (!tableDesc[col.name]) {
      await queryInterface.addColumn('users', col.name, col.definition);
    }
  }
}

// Start database, RabbitMQ event consumers, and HTTP server
db.sequelize
  .sync()
  .then(() => ensurePasskeyColumns())
  .then(async () => {
    console.log('Database synced.');
    try {
      await queueService.startSyncConsumer();
      await pushQueue.startPushConsumer();
      console.log('RabbitMQ event consumers started (bank sync & push notifications).');
    } catch (err) {
      console.error('Failed to start RabbitMQ consumers:', err.message);
    }
    return seedSandboxUser();
  })
  .catch((err) => {
    console.error('Database sync failed:', err.message);
  });

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

async function shutdown() {
  await eventBus.close();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
