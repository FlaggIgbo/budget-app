const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { getEnvConfig } = require('./config/env.config');
const { isSandboxMode } = require('./services/otp.service');
const sentryService = require('./services/sentry.service');

// Initialize Sentry error logging stub
sentryService.initSentry();

const app = express();

// Parse cookies and request bodies
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Enable CORS so the frontend can talk to the backend
let allowedOrigins = ['http://localhost:4200', 'http://localhost:3000'];
if (process.env.CORS_ORIGIN) {
  const rawOrigins = process.env.CORS_ORIGIN.split(',');
  allowedOrigins = [];
  for (let i = 0; i < rawOrigins.length; i++) {
    allowedOrigins.push(rawOrigins[i].trim());
  }
}
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Get Plaid & environment public configuration
app.get('/api/config', (req, res) => {
  const envConfig = getEnvConfig();
  const config = {
    environment: envConfig.appEnv,
    plaidConfigured: Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET),
    plaidEnvironment: envConfig.plaidEnv,
    allowedPlaidEnvironments: envConfig.isDevelopment
      ? envConfig.allowedPlaidEnvsInDev
      : ['production'],
    storageProvider: envConfig.storageProvider,
  };

  // Provide test phone and code when in sandbox mode
  if (isSandboxMode()) {
    config.authSandbox = {
      phone: '+15551234567',
      otp: '123456',
    };
  }

  res.json(config);
});

// Load database models and API routes
require('./models');
require('./routes/index.routes')(app);
require('./routes/auth.routes')(app);
require('./routes/bank.routes')(app);
require('./routes/profile.routes')(app);
require('./routes/chat.routes')(app);

// Global error handler
app.use(require('./middleware/errorHandler'));

module.exports = app;
