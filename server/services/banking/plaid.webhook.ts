import crypto = require('crypto');
import type { ServiceResult } from '../../types';
import db = require('../../models');
import plaidAdapter = require('./plaid.adapter');
import eventBus = require('../events/eventBus.service');
import envConfigModule = require('../../config/env.config');
const { getEnvConfig } = envConfigModule;
import sentryService = require('../infrastructure/sentry.service');

// ============================================================================
// PLAID WEBHOOK VERIFICATION & DOMAIN EVENT DISPATCHER
// Primary event trigger for bank account & transaction updates.
// Verifies Plaid's `Plaid-Verification` ES256 JWT + SHA-256 request body hash,
// resolves the Plaid `item_id` to an Enrollment, and emits domain events onto
// the RabbitMQ `budget_app.events` topic exchange.
// ============================================================================

const MAX_JWT_AGE_SECONDS = 5 * 60; // Plaid recommends rejecting JWTs older than 5 minutes
const JWK_CACHE_TTL_MS = 60 * 60 * 1000; // Cache Plaid JWKs for 1 hour
const PRIORITY_WEBHOOK = 5;

const SYNC_TRANSACTION_WEBHOOK_CODES = new Set([
  'SYNC_UPDATES_AVAILABLE',
  'INITIAL_UPDATE',
  'HISTORICAL_UPDATE',
  'DEFAULT_UPDATE',
  'TRANSACTIONS_REMOVED',
]);

const ITEM_ERROR_WEBHOOK_CODES = new Set([
  'ERROR',
  'PENDING_EXPIRATION',
  'USER_PERMISSION_REVOKED',
]);

const jwkCache = new Map<string, { jwk: Record<string, any>; expiresAt: number }>();

function fromBase64Url(str: string): Buffer {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLen), 'base64');
}

function clearWebhookKeyCache() {
  jwkCache.clear();
}

async function getVerificationJwk(kid: string): Promise<Record<string, any> | null> {
  const cached = jwkCache.get(kid);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.jwk;
  }

  const key = await plaidAdapter.getWebhookVerificationKey(kid);
  if (!key) {
    return null;
  }

  jwkCache.set(kid, {
    jwk: key,
    expiresAt: Date.now() + JWK_CACHE_TTL_MS,
  });
  return key;
}

// Verify Plaid's `Plaid-Verification` JWT header and SHA-256 body hash
async function verifyPlaidWebhook(
  rawBody: string,
  verificationHeader?: string | null
): Promise<ServiceResult> {
  const envConfig = getEnvConfig();
  const skipVerification =
    !envConfig.isProduction && process.env.PLAID_WEBHOOK_VERIFICATION_SKIP === 'true';

  if (!verificationHeader || typeof verificationHeader !== 'string') {
    if (skipVerification) {
      return { ok: true, skipped: true };
    }
    return { ok: false, status: 401, error: 'Missing Plaid-Verification header' };
  }

  const parts = verificationHeader.trim().split('.');
  if (parts.length !== 3) {
    return { ok: false, status: 401, error: 'Malformed Plaid-Verification JWT' };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  let header: Record<string, any>;
  let claims: Record<string, any>;
  try {
    header = JSON.parse(fromBase64Url(encodedHeader).toString('utf8'));
    claims = JSON.parse(fromBase64Url(encodedPayload).toString('utf8'));
  } catch {
    return { ok: false, status: 401, error: 'Invalid Plaid-Verification JWT encoding' };
  }

  if (header.alg !== 'ES256') {
    return { ok: false, status: 401, error: 'Unsupported Plaid-Verification JWT algorithm' };
  }

  if (!header.kid || typeof header.kid !== 'string') {
    return { ok: false, status: 401, error: 'Missing kid in Plaid-Verification JWT header' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof claims.iat !== 'number' || Math.abs(nowSec - claims.iat) > MAX_JWT_AGE_SECONDS) {
    return { ok: false, status: 401, error: 'Expired or invalid Plaid-Verification JWT iat' };
  }

  let jwk: Record<string, any> | null;
  try {
    jwk = await getVerificationJwk(header.kid);
  } catch (err) {
    sentryService.captureException(err, {
      service: 'plaid.webhook',
      action: 'getVerificationJwk',
      kid: header.kid,
    });
    return { ok: false, status: 401, error: 'Failed to retrieve Plaid webhook verification key' };
  }

  if (!jwk) {
    return { ok: false, status: 401, error: 'Unknown Plaid webhook verification key' };
  }

  try {
    const publicKey = crypto.createPublicKey({ key: jwk as any, format: 'jwk' });
    const sigBuf = fromBase64Url(encodedSignature);
    const verified = crypto.verify(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      sigBuf
    );

    if (!verified) {
      return { ok: false, status: 401, error: 'Invalid Plaid-Verification JWT signature' };
    }
  } catch {
    return { ok: false, status: 401, error: 'Plaid-Verification signature verification failed' };
  }

  if (typeof claims.request_body_sha256 !== 'string' || !claims.request_body_sha256) {
    return { ok: false, status: 401, error: 'Missing request_body_sha256 claim' };
  }

  const computedHash = crypto
    .createHash('sha256')
    .update(rawBody || '', 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(claims.request_body_sha256.toLowerCase(), 'utf8');
  const actualBuf = Buffer.from(computedHash.toLowerCase(), 'utf8');

  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, status: 401, error: 'Plaid webhook request body hash mismatch' };
  }

  return { ok: true, claims };
}

// Handle incoming Plaid webhook payload and emit the corresponding domain event
async function handlePlaidWebhook(
  payload: Record<string, any>,
  options: { rawBody?: string; verificationHeader?: string | null } = {}
): Promise<ServiceResult> {
  const rawBody =
    typeof options.rawBody === 'string' ? options.rawBody : JSON.stringify(payload || {});
  const verification = await verifyPlaidWebhook(rawBody, options.verificationHeader);
  if (!verification.ok) {
    return verification;
  }

  const webhookType = String(payload?.webhook_type || '').toUpperCase();
  const webhookCode = String(payload?.webhook_code || '').toUpperCase();
  const itemId = typeof payload?.item_id === 'string' ? payload.item_id.trim() : '';

  if (!webhookType || !webhookCode || !itemId) {
    return {
      ok: false,
      status: 400,
      error: 'webhook_type, webhook_code, and item_id are required',
    };
  }

  const enrollment = await db.Enrollment.findOne({
    where: { enrollmentId: itemId },
  });

  if (!enrollment || !enrollment.userId) {
    return {
      ok: true,
      ignored: true,
      reason: 'Enrollment not found for item_id',
    };
  }

  if (
    (webhookType === 'TRANSACTIONS' && SYNC_TRANSACTION_WEBHOOK_CODES.has(webhookCode)) ||
    (webhookType === 'ITEM' && webhookCode === 'LOGIN_REPAIRED')
  ) {
    const event = await eventBus.publishEvent(
      eventBus.DomainEvents.PLAID_SYNC_UPDATES_AVAILABLE,
      {
        userId: enrollment.userId,
        enrollmentId: enrollment.enrollmentId,
        itemId,
        institutionName: enrollment.institutionName || null,
        webhookType,
        webhookCode,
      },
      { priority: PRIORITY_WEBHOOK }
    );

    return {
      ok: true,
      eventId: event.id,
      eventType: event.type,
    };
  }

  if (webhookType === 'ITEM' && ITEM_ERROR_WEBHOOK_CODES.has(webhookCode)) {
    const event = await eventBus.publishEvent(eventBus.DomainEvents.PLAID_ITEM_ERROR, {
      userId: enrollment.userId,
      enrollmentId: enrollment.enrollmentId,
      itemId,
      institutionName: enrollment.institutionName || null,
      webhookType,
      webhookCode,
      error: payload.error || null,
    });

    return {
      ok: true,
      eventId: event.id,
      eventType: event.type,
    };
  }

  return {
    ok: true,
    ignored: true,
    reason: `Unhandled Plaid webhook ${webhookType}:${webhookCode}`,
  };
}

export = {
  MAX_JWT_AGE_SECONDS,
  PRIORITY_WEBHOOK,
  clearWebhookKeyCache,
  verifyPlaidWebhook,
  handlePlaidWebhook,
};
