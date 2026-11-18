const { getEnvConfig } = require('../config/env.config');
const sentryService = require('./sentry.service');

// ============================================================================
// OBJECT STORAGE SERVICE (MinIO Local S3 / Production Cloudflare R2)
// Stores and retrieves user bank statements (PDF/CSV/text) used for archival
// and for enriching the LLM Financial Assistant's context.
// ============================================================================

// Return active S3/R2 storage endpoint and bucket configuration
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

    // TODO: Wire up @aws-sdk/client-s3 PutObjectCommand against `config.endpoint`
    // and `config.bucket` to persist bank statement bytes in MinIO / Cloudflare R2.
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

    // TODO: Wire up @aws-sdk/client-s3 ListObjectsV2Command against `config.bucket`
    // with `Prefix: prefix` to list all uploaded bank statements for the user.
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

    // TODO: Wire up @aws-sdk/client-s3 GetObjectCommand to fetch statement content
    // for parsing or LLM context injection.
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

module.exports = {
  getStorageConfig,
  uploadBankStatement,
  listUserStatements,
  getBankStatement,
};
