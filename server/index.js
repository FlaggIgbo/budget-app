/**
 * Budget App API - Entry point
 * PEAN Stack: PostgreSQL + Express + Angular + Node.js
 *
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// CORS - allow Angular dev server (and production origin when configured)
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:4200',
  credentials: true,
};
app.use(cors(corsOptions));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database sync (models will be loaded when added)
const db = require('./models');
db.sequelize
  .sync()
  .then(() => {
    console.log('Database synced.');
  })
  .catch((err) => {
    console.error('Database sync failed:', err.message);
  });

// Routes
require('./routes/index.routes')(app);
// require('./routes/auth.routes')(app);
// require('./routes/user.routes')(app);

// Error handler (must be last)
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Budget App API running on port ${PORT}`);
});
