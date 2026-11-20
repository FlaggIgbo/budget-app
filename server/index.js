const { DataTypes } = require('sequelize');
const app = require('./app');
const db = require('./models');
const { seedSandboxUser } = require('./seed/sandbox');
const { startDailySyncScheduler } = require('./services/jobs/cron.scheduler');

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

// Start database, daily RabbitMQ sync CRON scheduler, and HTTP server
db.sequelize
  .sync()
  .then(() => ensurePasskeyColumns())
  .then(() => {
    console.log('Database synced.');
    startDailySyncScheduler();
    return seedSandboxUser();
  })
  .catch((err) => {
    console.error('Database sync failed:', err.message);
  });

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
