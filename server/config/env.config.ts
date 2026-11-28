// ============================================================================
// ENVIRONMENT CONFIGURATION (DEVELOPMENT vs. PRODUCTION)
// Supports two primary environments:
//   1. development (localhost): Local PostgreSQL, Redis, RabbitMQ, MinIO,
//      and allows testing against either Plaid 'sandbox' or Plaid 'development'.
//   2. production: Hosted PostgreSQL, Redis, RabbitMQ, Cloudflare R2,
//      and Plaid 'production'.
// ============================================================================

const ALLOWED_PLAID_ENVS_IN_DEV = ['sandbox', 'development'];

function getAppEnvironment() {
  const explicitEnv = (process.env.ENV || process.env.env || '').trim().toLowerCase();
  if (explicitEnv === 'production' || explicitEnv === 'prod') {
    return 'production';
  }
  if (explicitEnv === 'development' || explicitEnv === 'dev' || explicitEnv === 'preview') {
    return 'development';
  }

  const vercelEnv = (process.env.VERCEL_ENV || '').trim().toLowerCase();
  if (vercelEnv === 'production' || vercelEnv === 'prod') {
    return 'production';
  }
  if (vercelEnv === 'development' || vercelEnv === 'dev' || vercelEnv === 'preview') {
    return 'development';
  }

  const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();
  if (nodeEnv === 'production' || nodeEnv === 'prod') {
    return 'production';
  }
  return 'development';
}

function getPlaidEnvironment() {
  const appEnv = getAppEnvironment();
  const rawPlaidEnv = (process.env.PLAID_ENV || '').toLowerCase();

  if (appEnv === 'production') {
    if (
      rawPlaidEnv === 'sandbox' ||
      rawPlaidEnv === 'development' ||
      rawPlaidEnv === 'production'
    ) {
      return rawPlaidEnv;
    }
    return 'production';
  }

  // In development (localhost), allow testing against Plaid 'sandbox' or Plaid 'development'
  if (ALLOWED_PLAID_ENVS_IN_DEV.includes(rawPlaidEnv)) {
    return rawPlaidEnv;
  }
  return 'sandbox';
}

function getStorageProvider() {
  const appEnv = getAppEnvironment();
  const configured = (process.env.STORAGE_PROVIDER || '').toLowerCase();
  if (configured === 'minio' || configured === 'r2') {
    return configured;
  }
  return appEnv === 'production' ? 'r2' : 'minio';
}

function getEnvConfig() {
  const appEnv = getAppEnvironment();
  const isProduction = appEnv === 'production';

  return {
    appEnv,
    isProduction,
    isDevelopment: !isProduction,
    port: parseInt(process.env.PORT || '4000', 10),
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:4200',
    plaidEnv: getPlaidEnvironment(),
    plaidWebhookUrl: (process.env.PLAID_WEBHOOK_URL || '').trim(),
    allowedPlaidEnvsInDev: ALLOWED_PLAID_ENVS_IN_DEV,
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
    storageProvider: getStorageProvider(),
    statementsBucket: process.env.STATEMENTS_BUCKET || 'budget-statements',
    s3Endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    sentryDsn: process.env.SENTRY_DSN || '',
    vapidSubject: process.env.VAPID_SUBJECT || 'mailto:support@budgetapp.local',
    vapidConfigured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
  };
}

export = {
  ALLOWED_PLAID_ENVS_IN_DEV,
  getAppEnvironment,
  getPlaidEnvironment,
  getStorageProvider,
  getEnvConfig,
};
