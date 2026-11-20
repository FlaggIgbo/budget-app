const fs = require('fs');
const path = require('path');

// Load local .env file via native Node.js process.loadEnvFile() when present
const envFilePath = path.join(__dirname, '.env');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

const express = require('express');
const { getEnvConfig } = require('./config/env.config');
const { isSandboxMode } = require('./services/authentication/otp.service');
const { pushService } = require('./push_service');
const sentryService = require('./services/infrastructure/sentry.service');

// Initialize Sentry error logging stub
sentryService.initSentry();

const app = express();

// Native cookie header parser (replaces cookie-parser)
app.use((req, _res, next) => {
  req.cookies = {};
  const rawCookie = req.headers.cookie;
  if (rawCookie) {
    for (const pair of rawCookie.split(';')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx <= 0) {
        continue;
      }
      const key = pair.slice(0, eqIdx).trim();
      const rawVal = pair.slice(eqIdx + 1).trim();
      if (!key) {
        continue;
      }
      try {
        req.cookies[key] = decodeURIComponent(rawVal);
      } catch {
        req.cookies[key] = rawVal;
      }
    }
  }
  next();
});

// Parse JSON and URL-encoded request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Native CORS middleware (replaces cors package)
let allowedOrigins = ['http://localhost:4200', 'http://localhost:3000'];
if (process.env.CORS_ORIGIN) {
  allowedOrigins = process.env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] || 'Content-Type, Authorization'
    );
    return res.status(204).end();
  }

  return next();
});

// Get Plaid, Web Push & environment public configuration
app.get('/api/config', (req, res) => {
  const envConfig = getEnvConfig();
  const vapidConfig = pushService.getVapidConfig();
  const config = {
    environment: envConfig.appEnv,
    plaidConfigured: Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET),
    plaidEnvironment: envConfig.plaidEnv,
    allowedPlaidEnvironments: envConfig.isDevelopment
      ? envConfig.allowedPlaidEnvsInDev
      : ['production'],
    storageProvider: envConfig.storageProvider,
    pushConfigured: vapidConfig.configured,
    vapidPublicKey: vapidConfig.publicKey,
  };

  // Provide development test phone and OTP ONLY outside production
  if (!envConfig.isProduction && isSandboxMode()) {
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
require('./routes/push_service.routes')(app);

// Global error handler
app.use(require('./middleware/errorHandler'));

module.exports = app;
