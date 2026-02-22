/**
 * Budget App API - Entry point
 * PEAN Stack: PostgreSQL + Express + Angular + Node.js
 *
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// CORS - allow Angular dev server (any localhost port) and production origin
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : [/^http:\/\/localhost(:\d+)?$/];
const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
};
app.use(cors(corsOptions));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check before DB (so it works even if DB fails)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Budget App API is running' });
});

// Public config for client (Teller Connect needs applicationId)
app.get('/api/config', (req, res) => {
  res.json({
    tellerApplicationId: process.env.TELLER_APPLICATION_ID || '',
    tellerEnvironment: process.env.TELLER_ENVIRONMENT || 'sandbox',
  });
});

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
require('./routes/teller.routes')(app);
// require('./routes/auth.routes')(app);
// require('./routes/user.routes')(app);

// Error handler (must be last)
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Budget App API running on port ${PORT}`);
});
