/**
 * Budget App API - Entry point
 * PEAN Stack: PostgreSQL + Express + Angular + Node.js
 */
const app = require('./app');
const { seedSandboxUser } = require('./seed/sandbox');

const db = require('./models');
db.sequelize
  .sync()
  .then(() => {
    console.log('Database synced.');
    return seedSandboxUser();
  })
  .catch((err) => console.error('Database sync failed:', err.message));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Budget App API running on port ${PORT}`);
});
