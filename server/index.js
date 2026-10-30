const app = require('./app');
const db = require('./models');
const { seedSandboxUser } = require('./seed/sandbox');

// Start database and server
db.sequelize
  .sync()
  .then(() => {
    console.log('Database synced.');
    return seedSandboxUser();
  })
  .catch((err) => {
    console.error('Database sync failed:', err.message);
  });

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
