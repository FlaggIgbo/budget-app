import fs = require('fs');
import path = require('path');

// Load local .env file via native Node.js process.loadEnvFile() when present
const envFilePath = path.join(__dirname, '.env');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

import express = require('express');
import envConfigModule = require('./config/env.config');
const { getEnvConfig } = envConfigModule;
import otpServiceModule = require('./services/authentication/otp.service');
const { isSandboxMode } = otpServiceModule;
import pushServiceModule = require('./push_service');
const { pushService } = pushServiceModule;
import sentryService = require('./services/infrastructure/sentry.service');

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

// Parse JSON and URL-encoded request bodies (capture rawBody for Plaid webhook SHA-256 verification)
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
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
  const config: Record<string, any> = {
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
import './models';
import indexRoutes = require('./routes/index.routes');
import authRoutes = require('./routes/auth.routes');
import bankRoutes = require('./routes/bank.routes');
import profileRoutes = require('./routes/profile.routes');
import chatRoutes = require('./routes/chat.routes');
import pushServiceRoutes = require('./routes/push_service.routes');
import errorHandler = require('./middleware/errorHandler');

indexRoutes(app);
authRoutes(app);
bankRoutes(app);
profileRoutes(app);
chatRoutes(app);
pushServiceRoutes(app);

// Global error handler
app.use(errorHandler);

export = app;
