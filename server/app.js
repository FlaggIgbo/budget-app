const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const app = express();

// Parse cookies and request bodies
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enable CORS for frontend
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : [/^http:\/\/localhost(:\d+)?$/];
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Get Teller public configuration
app.get('/api/config', (req, res) => {
  const isSandbox =
    process.env.TELLER_ENVIRONMENT === 'sandbox' || process.env.NODE_ENV === 'development';

  const config = {
    tellerApplicationId: process.env.TELLER_APPLICATION_ID || '',
    tellerEnvironment: process.env.TELLER_ENVIRONMENT || 'sandbox',
  };

  // Provide test phone and code when in sandbox mode
  if (isSandbox) {
    config.authSandbox = { phone: '555-555-5555', otp: '123456' };
  }

  res.json(config);
});

// Load database models and API routes
require('./models');
require('./routes/index.routes')(app);
require('./routes/auth.routes')(app);
require('./routes/teller.routes')(app);
require('./routes/profile.routes')(app);

// Global error handler
app.use(require('./middleware/errorHandler'));

module.exports = app;
