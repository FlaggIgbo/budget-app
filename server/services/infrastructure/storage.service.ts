import envConfigModule = require('../../config/env.config');
const { getEnvConfig } = envConfigModule;
import sentryService = require('./sentry.service');

// ============================================================================
// OBJECT STORAGE SERVICE (MinIO in Local Dev / Cloudflare R2 in Production)
// NOTE: This repo intentionally does NOT use AWS S3 — only MinIO (dev) and
// Cloudflare R2 (prod). Both expose S3-compatible HTTPS APIs that should be
// called directly using native `fetch()` + `node:crypto` for AWS SigV4 signing
// (zero `@aws-sdk/*` third-party dependencies).
// ============================================================================

// Return active MinIO / Cloudflare R2 storage endpoint and bucket configuration
function getStorageConfig() {
  const env = getEnvConfig();
  const isR2 = env.storageProvider === 'r2';

  const endpoint = isR2
    ? `https://${env.cloudflareAccountId || 'account'}.r2.cloudflarestorage.com`
    : env.s3Endpoint;

  return {
    provider: env.storageProvider, // 'minio' in development, 'r2' in production
    bucket: env.statementsBucket,
    endpoint,
    accessKeyId: isR2
      ? process.env.R2_ACCESS_KEY_ID || ''
      : process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
    secretAccessKey: isR2
      ? process.env.R2_SECRET_ACCESS_KEY || ''
      : process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin',
  };
}

// Upload a bank statement (PDF/CSV) to MinIO (local dev) or Cloudflare R2 (production)
async function uploadBankStatement(userId, { institutionName, statementPeriod, fileName }, buffer) {
  try {
    const config = getStorageConfig();
    const key = `statements/${userId}/${statementPeriod || 'latest'}/${fileName || 'statement.pdf'}`;

    // TODO: Do NOT install `@aws-sdk/client-s3` (we only use MinIO and Cloudflare R2, not AWS S3).
    // Sign an S3-compatible SigV4 PUT request with `node:crypto` (HMAC-SHA256 / SHA-256 payload hash)
    // and send it directly via native `fetch(`${config.endpoint}/${config.bucket}/${key}`, { method: 'PUT', ... })`.
    return {
      todo: true,
      provider: config.provider,
      bucket: config.bucket,
      key,
      institutionName: institutionName || 'Bank',
      sizeBytes: buffer ? buffer.length : 0,
    };
  } catch (err) {
    sentryService.captureException(err, {
      service: 'storage.service',
      action: 'uploadBankStatement',
    });
    throw err;
  }
}

// List stored bank statements for a user from MinIO / Cloudflare R2
async function listUserStatements(userId) {
  try {
    const config = getStorageConfig();
    const prefix = `statements/${userId}/`;

    // TODO: Do NOT install `@aws-sdk/client-s3` (MinIO / Cloudflare R2 only).
    // Sign an S3-compatible SigV4 GET request with `node:crypto` and call native
    // `fetch(`${config.endpoint}/${config.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}`)`.
    return {
      todo: true,
      provider: config.provider,
      bucket: config.bucket,
      prefix,
      statements: [],
    };
  } catch (err) {
    sentryService.captureException(err, {
      service: 'storage.service',
      action: 'listUserStatements',
    });
    throw err;
  }
}

// Retrieve a single bank statement from MinIO / Cloudflare R2
async function getBankStatement(userId, statementKey) {
  try {
    const config = getStorageConfig();

    // TODO: Do NOT install `@aws-sdk/client-s3` (MinIO / Cloudflare R2 only).
    // Sign an S3-compatible SigV4 GET request with `node:crypto` and call native
    // `fetch(`${config.endpoint}/${config.bucket}/${statementKey}`)` for parsing or LLM context injection.
    return {
      todo: true,
      provider: config.provider,
      bucket: config.bucket,
      key: statementKey,
      userId,
      content: null,
    };
  } catch (err) {
    sentryService.captureException(err, { service: 'storage.service', action: 'getBankStatement' });
    throw err;
  }
}

export = {
  getStorageConfig,
  uploadBankStatement,
  listUserStatements,
  getBankStatement,
};
